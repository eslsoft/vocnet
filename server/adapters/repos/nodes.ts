import { entries, facts, senses, worklist } from '@server/db/schema'
import type { FactOf } from '@server/domain/fact'
import type { SenseWithLemma } from '@server/domain/nodes'
import type { Lemma } from '@server/domain/term'
import type { NodeRepo, PageRequest } from '@server/usecases/ports'
import { type EntryId, type FactStatus, factStatusSchema } from '@shared/facts'
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  getTableColumns,
  gt,
  gte,
  inArray,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'
import { type Db, decodeCursor, fromFact, liveStatus, page, toEntry, toFact, toSense } from './rows'
import { insertWorklistRow } from './work'

const PREFIX_END = '\u{10FFFF}'
const entryCursor = z.object({ lemma: z.string() })

const senseColumns = {
  id: senses.id,
  entryId: senses.entryId,
  pos: senses.pos,
  createdBy: senses.createdBy,
  createdAt: senses.createdAt,
  lemma: entries.lemma,
}

const toSenseWithLemma = (row: Parameters<typeof toSense>[0] & { lemma: string }): SenseWithLemma => ({
  ...toSense(row),
  lemma: row.lemma as Lemma,
})

/** Lemma range scan on the unique lemma index. */
function lemmaStartsWith(prefix: string) {
  return prefix ? and(gte(entries.lemma, prefix), lt(entries.lemma, `${prefix}${PREFIX_END}`)) : undefined
}

const noFacts = (): Record<FactStatus, number> =>
  Object.fromEntries(factStatusSchema.options.map((status) => [status, 0])) as Record<FactStatus, number>

function publishedEntry(entryId: SQL | typeof entries.id, db: Db) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(facts)
      .where(and(eq(facts.kind, 'entry'), eq(facts.subjectId, entryId), eq(facts.status, 'published'))),
  )
}

/**
 * The statements behind one page of entry summaries. Each one reads only the page's entries and
 * their senses and facts through an index, so a page costs the same however large the dictionary
 * grows. The glossed-sense count is an EXISTS on facts_subject_idx: joined to facts with
 * kind = 'sense', SQLite starts from facts_live_content_idx and reads every live sense fact.
 */
export function entrySummaryStatements(db: Db, prefix: string, { limit, cursor }: PageRequest) {
  const after = cursor ? decodeCursor(cursor, entryCursor) : undefined
  const inPage = and(lemmaStartsWith(prefix), after ? gt(entries.lemma, after.lemma) : undefined)
  const pageIds = db
    .select({ id: entries.id })
    .from(entries)
    .where(inPage)
    .orderBy(asc(entries.lemma))
    .limit(limit + 1)
  const entryStatus = db
    .select({ status: facts.status })
    .from(facts)
    .where(and(eq(facts.kind, 'entry'), eq(facts.subjectId, entries.id)))
    .orderBy(desc(liveStatus), desc(facts.updatedAt), desc(facts.id))
    .limit(1)
  const liveGloss = db
    .select({ one: sql`1` })
    .from(facts)
    .where(and(eq(facts.subjectId, senses.id), eq(facts.kind, 'sense'), liveStatus))

  return [
    db
      .select({
        id: entries.id,
        lemma: entries.lemma,
        createdAt: entries.createdAt,
        lastWorkedAt: worklist.lastWorkedAt,
        entryStatus: sql<string | null>`(${entryStatus})`,
      })
      .from(entries)
      .leftJoin(worklist, eq(worklist.entryId, entries.id))
      .where(inPage)
      .orderBy(asc(entries.lemma))
      .limit(limit + 1),
    db
      .select({ entryId: facts.subjectId, status: facts.status, count: count() })
      .from(facts)
      .where(inArray(facts.subjectId, pageIds))
      .groupBy(facts.subjectId, facts.status),
    db
      .select({ entryId: senses.entryId, status: facts.status, count: count() })
      .from(senses)
      .innerJoin(facts, eq(facts.subjectId, senses.id))
      .where(inArray(senses.entryId, pageIds))
      .groupBy(senses.entryId, facts.status),
    db
      .select({ entryId: senses.entryId, count: count() })
      .from(senses)
      .where(and(inArray(senses.entryId, pageIds), exists(liveGloss)))
      .groupBy(senses.entryId),
  ] as const
}

export function createNodeRepo(db: Db): NodeRepo {
  const sensesOf = (entryId: EntryId) => db.select({ id: senses.id }).from(senses).where(eq(senses.entryId, entryId))

  return {
    async findEntryByLemma(lemma) {
      const row = await db.select().from(entries).where(eq(entries.lemma, lemma)).get()
      return row ? toEntry(row) : null
    },

    async findEntry(id) {
      const row = await db.select().from(entries).where(eq(entries.id, id)).get()
      return row ? toEntry(row) : null
    },

    async insertEntry(entry) {
      await db.batch([db.insert(entries).values(entry).onConflictDoNothing(), insertWorklistRow(db, entry.id)])
      const row = await db.select().from(entries).where(eq(entries.lemma, entry.lemma)).get()
      if (!row) throw new Error(`Entry ${entry.lemma} vanished after insert.`)
      return toEntry(row)
    },

    async findSense(id) {
      const row = await db
        .select(senseColumns)
        .from(senses)
        .innerJoin(entries, eq(entries.id, senses.entryId))
        .where(eq(senses.id, id))
        .get()
      return row ? toSenseWithLemma(row) : null
    },

    async findSenseByGloss(entryId, pos, contentKeys) {
      const row = await db
        .select({ sense: senses, fact: facts })
        .from(senses)
        .innerJoin(
          facts,
          and(
            eq(facts.kind, 'sense'),
            inArray(facts.contentKey, contentKeys),
            eq(facts.subjectId, senses.id),
            liveStatus,
          ),
        )
        .where(and(eq(senses.entryId, entryId), eq(senses.pos, pos)))
        .get()
      return row ? { sense: toSense(row.sense), fact: toFact(row.fact) } : null
    },

    async insertSenseWithFact(sense, fact, creationKey) {
      // The creation index makes a concurrent duplicate a no-op, and the fact is inserted only
      // if its sense was, so the loser of a race leaves nothing behind and reads the winner.
      const row = fromFact(fact)
      const values = Object.fromEntries(
        Object.entries(getTableColumns(facts)).map(([key, column]) => [
          key,
          sql`${column.mapToDriverValue(row[key as keyof typeof row])}`.as(column.name),
        ]),
      )
      await db.batch([
        db
          .insert(senses)
          .values({ ...sense, creationKey })
          .onConflictDoNothing(),
        db.insert(facts).select(db.select(values).from(senses).where(eq(senses.id, sense.id)) as never),
      ])
      const stored = await db
        .select({ sense: senses, fact: facts })
        .from(senses)
        .innerJoin(facts, and(eq(facts.kind, 'sense'), eq(facts.subjectId, senses.id)))
        .where(and(eq(senses.entryId, sense.entryId), eq(senses.pos, sense.pos), eq(senses.creationKey, creationKey)))
        .orderBy(asc(facts.createdAt), asc(facts.id))
        .get()
      if (!stored) throw new Error(`Sense ${sense.id} has no defining fact right after insert.`)
      return { sense: toSense(stored.sense), fact: toFact(stored.fact) }
    },

    async listLiveGlosses(entryId) {
      const rows = await db
        .select({ sense: senses, fact: facts })
        .from(senses)
        .innerJoin(facts, and(eq(facts.kind, 'sense'), eq(facts.subjectId, senses.id), liveStatus))
        .where(eq(senses.entryId, entryId))
        .orderBy(asc(senses.createdAt), asc(senses.id), asc(facts.createdAt), asc(facts.id))
      return rows.map((row) => ({ sense: toSense(row.sense), fact: toFact(row.fact) as FactOf<'sense'> }))
    },

    async loadEntrySnapshot(entry) {
      const own = sensesOf(entry.id)
      const outgoingTargets = db
        .select({ id: facts.objectId })
        .from(facts)
        .where(and(eq(facts.kind, 'relation'), inArray(facts.subjectId, own)))
      const incomingSources = db
        .select({ id: facts.subjectId })
        .from(facts)
        .where(and(eq(facts.kind, 'relation'), inArray(facts.objectId, own)))
      const neighborIds = or(inArray(senses.id, outgoingTargets), inArray(senses.id, incomingSources))
      const neighborEntries = db.select({ id: senses.entryId }).from(senses).where(neighborIds)
      const neighborSenseIds = db.select({ id: senses.id }).from(senses).where(neighborIds)
      const order = [asc(facts.createdAt), asc(facts.id)]

      const [ownSenses, subjectFacts, incoming, neighborSenses, neighborFacts] = await db.batch([
        db
          .select(senseColumns)
          .from(senses)
          .innerJoin(entries, eq(entries.id, senses.entryId))
          .where(eq(senses.entryId, entry.id))
          .orderBy(asc(senses.createdAt), asc(senses.id)),
        db
          .select()
          .from(facts)
          .where(or(eq(facts.subjectId, entry.id), inArray(facts.subjectId, own)))
          .orderBy(...order),
        db
          .select()
          .from(facts)
          .where(and(eq(facts.kind, 'relation'), inArray(facts.objectId, own)))
          .orderBy(...order),
        db.select(senseColumns).from(senses).innerJoin(entries, eq(entries.id, senses.entryId)).where(neighborIds),
        db
          .select()
          .from(facts)
          .where(
            or(
              and(eq(facts.kind, 'sense'), inArray(facts.subjectId, neighborSenseIds)),
              and(eq(facts.kind, 'entry'), inArray(facts.subjectId, neighborEntries)),
            ),
          )
          .orderBy(...order),
      ])

      return {
        entry,
        senses: ownSenses.map(toSenseWithLemma),
        facts: subjectFacts.map(toFact),
        incoming: incoming.map(toFact),
        neighbors: { senses: neighborSenses.map(toSenseWithLemma), facts: neighborFacts.map(toFact) },
      }
    },

    async searchPublishedEntries(prefix, { limit, cursor }) {
      const after = cursor ? decodeCursor(cursor, entryCursor) : undefined
      const rows = await db
        .select({ id: entries.id, lemma: entries.lemma })
        .from(entries)
        .where(
          and(
            lemmaStartsWith(prefix),
            after ? gt(entries.lemma, after.lemma) : undefined,
            publishedEntry(entries.id, db),
          ),
        )
        .orderBy(asc(entries.lemma))
        .limit(limit + 1)
      // lemma is unique, so it is its own keyset tiebreaker.
      return page(
        rows,
        limit,
        (row) => ({ id: row.id as EntryId, lemma: row.lemma }),
        (row) => ({ lemma: row.lemma }),
      )
    },

    async listEntrySummaries(prefix, request) {
      const [rows, entryFacts, senseFacts, glossed] = await db.batch(entrySummaryStatements(db, prefix, request))

      const factCounts = new Map<string, Record<FactStatus, number>>()
      for (const row of [...entryFacts, ...senseFacts]) {
        const counts = factCounts.get(row.entryId) ?? noFacts()
        counts[factStatusSchema.parse(row.status)] += row.count
        factCounts.set(row.entryId, counts)
      }
      const senseCounts = new Map(glossed.map((row) => [row.entryId, row.count]))
      // lemma is unique, so it is its own keyset tiebreaker.
      return page(
        rows,
        request.limit,
        (row) => ({
          id: row.id as EntryId,
          lemma: row.lemma,
          entry_status: row.entryStatus === null ? null : factStatusSchema.parse(row.entryStatus),
          sense_count: senseCounts.get(row.id) ?? 0,
          fact_counts: factCounts.get(row.id) ?? noFacts(),
          last_worked_at: row.lastWorkedAt,
          created_at: row.createdAt,
        }),
        (row) => ({ lemma: row.lemma }),
      )
    },

    async findPublishedForms(contentKeys) {
      const rows = await db
        .select({ entry: entries, fact: facts })
        .from(facts)
        .innerJoin(entries, eq(entries.id, facts.subjectId))
        .where(
          and(
            eq(facts.kind, 'form'),
            inArray(facts.contentKey, contentKeys),
            // Repeats the partial index predicate verbatim so SQLite can use the index.
            liveStatus,
            eq(facts.status, 'published'),
            publishedEntry(entries.id, db),
          ),
        )
        .orderBy(asc(entries.lemma), asc(facts.id))
      return rows.map((row) => ({ entry: toEntry(row.entry), fact: toFact(row.fact) as FactOf<'form'> }))
    },
  }
}
