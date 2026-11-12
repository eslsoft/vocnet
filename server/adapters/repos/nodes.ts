import { entries, facts, senses, workItems, worklist, workPasses } from '@server/db/schema'
import type { FactOf } from '@server/domain/fact'
import { levelOfRank, openItemStatus } from '@server/domain/monitor'
import type { EntryNode, SenseWithLemma } from '@server/domain/nodes'
import type { PrincipalRef } from '@server/domain/principal'
import { levelRank } from '@server/domain/reference'
import type { Lemma } from '@server/domain/term'
import { passKey } from '@server/domain/work'
import type { EntrySummaryFilter, NodeRepo, PageRequest } from '@server/usecases/ports'
import { type EntryId, type FactStatus, factStatusSchema } from '@shared/facts'
import type { CefrLevel } from '@shared/reference'
import { MAX_PASSES, workTypeSchema } from '@shared/work'
import { and, asc, count, eq, exists, gt, gte, inArray, lt, ne, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { type Db, decodeCursor, inIds, page, toEntry, toFact, toSense } from './rows'
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

const bumpRevision = { revision: sql`${worklist.revision} + 1` }

/** Lemma range scan on the unique lemma index. */
function lemmaStartsWith(prefix: string) {
  return prefix ? and(gte(entries.lemma, prefix), lt(entries.lemma, `${prefix}${PREFIX_END}`)) : undefined
}

/** The entry is admitted: an imported headword, or a phrase a published phrases list names. */
function liveEntryOf(entryId: SQL | typeof entries.id, db: Db) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(worklist)
      .where(and(eq(worklist.entryId, entryId), eq(worklist.live, true))),
  )
}

/**
 * The other live entries with a live morphology fact that names this lemma as a base. The JSON
 * text holds the lemma as a quoted string wherever a part names it, so `instr` reads only the
 * candidates' parts.
 */
function familyOf(db: Db, entry: EntryNode) {
  const quoted = JSON.stringify(entry.lemma)
  return db
    .selectDistinct({ lemma: entries.lemma })
    .from(facts)
    .innerJoin(entries, eq(entries.id, facts.subjectId))
    .where(
      and(
        eq(facts.kind, 'morphology'),
        inArray(facts.status, ['pending', 'published']),
        ne(entries.id, entry.id),
        sql`instr(${facts.payload}, ${quoted}) > 0`,
        sql`exists (select 1 from json_each(${facts.payload}, '$.parts') where json_extract(value, '$.role') = 'base' and json_extract(value, '$.lemma') = ${entry.lemma})`,
        liveEntryOf(entries.id, db),
      ),
    )
    .orderBy(asc(entries.lemma))
}

const noFacts = (): Record<FactStatus, number> =>
  Object.fromEntries(factStatusSchema.options.map((status) => [status, 0])) as Record<FactStatus, number>

/** The entry in the outer query has an item past the pass bound, read through work_items_entry_idx. */
function hasStuckItem(db: Db) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(workItems)
      .where(and(eq(workItems.entryId, entries.id), gte(workItems.attempts, MAX_PASSES))),
  )
}

/** The entry in the outer query's lemma has this lowest CEFR level, read by the worklist's primary key. */
function atLevel(db: Db, level: CefrLevel) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(worklist)
      .where(and(eq(worklist.entryId, entries.id), eq(worklist.levelRank, levelRank(level)))),
  )
}

/**
 * The statements behind one page of entry summaries. Each one reads only the page's entries and
 * their senses, facts, and items through an index, so a page costs the same however large the
 * dictionary grows; a filter is an EXISTS through an index per entry the lemma order reaches.
 */
export function entrySummaryStatements(
  db: Db,
  { prefix, level, stuck }: EntrySummaryFilter,
  { limit, cursor }: PageRequest,
  now: string,
) {
  const after = cursor ? decodeCursor(cursor, entryCursor) : undefined
  const inPage = and(
    lemmaStartsWith(prefix),
    after ? gt(entries.lemma, after.lemma) : undefined,
    level ? atLevel(db, level) : undefined,
    stuck ? hasStuckItem(db) : undefined,
  )
  const pageIds = db
    .select({ id: entries.id })
    .from(entries)
    .where(inPage)
    .orderBy(asc(entries.lemma))
    .limit(limit + 1)
  const inventorySize = db
    .select({ size: sql<number>`json_array_length(${facts.payload}, '$.senses')` })
    .from(facts)
    .where(and(eq(facts.kind, 'senses'), eq(facts.subjectId, entries.id), eq(facts.status, 'published')))
    .limit(1)
  const leased = sql<number>`coalesce(${workItems.leaseExpiresAt} > ${now}, 0)`

  return [
    db
      .select({
        id: entries.id,
        lemma: entries.lemma,
        createdAt: entries.createdAt,
        live: worklist.live,
        lastWorkedAt: worklist.lastWorkedAt,
        levelRank: worklist.levelRank,
        completeness: worklist.completeness,
        credibility: worklist.credibility,
        slotsTotal: worklist.slotsTotal,
        slotsPublished: worklist.slotsPublished,
        slotsPending: worklist.slotsPending,
        senseCount: sql<number | null>`(${inventorySize})`,
      })
      .from(entries)
      .innerJoin(worklist, eq(worklist.entryId, entries.id))
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
      .select({
        entryId: workItems.entryId,
        attempts: workItems.attempts,
        awaiting: workItems.awaiting,
        leased,
        count: count(),
      })
      .from(workItems)
      .where(inArray(workItems.entryId, pageIds))
      .groupBy(workItems.entryId, workItems.attempts, workItems.awaiting, leased),
  ] as const
}

const noWork = () => ({ total: 0, in_progress: 0, waiting_on_review: 0, stuck: 0 })

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
      await db.batch([db.insert(entries).values(entry).onConflictDoNothing(), insertWorklistRow(db, entry)])
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

    async listSenses(entryId) {
      const rows = await db
        .select()
        .from(senses)
        .where(eq(senses.entryId, entryId))
        .orderBy(asc(senses.createdAt), asc(senses.id))
      return rows.map(toSense)
    },

    async insertSenses(rows) {
      const [first] = rows
      if (!first) return []
      // The creation index makes a concurrent duplicate a no-op; the stored rows are read back by key.
      await db
        .insert(senses)
        .values(rows.map(({ sense, creationKey }) => ({ ...sense, creationKey })))
        .onConflictDoNothing()
      const stored = await db.select().from(senses).where(eq(senses.entryId, first.sense.entryId))
      const byKey = new Map(stored.map((row) => [`${row.pos}|${row.creationKey}`, row]))
      return rows.map(({ sense, creationKey }) => {
        const row = byKey.get(`${sense.pos}|${creationKey}`)
        if (!row) throw new Error(`Sense ${sense.id} vanished after insert.`)
        return toSense(row)
      })
    },

    async admission(entryId) {
      const row = await db
        .select({ live: worklist.live, batch: worklist.batch })
        .from(worklist)
        .where(eq(worklist.entryId, entryId))
        .get()
      if (!row) throw new Error(`Entry ${entryId} has no worklist row.`)
      return row
    },

    async admit(lemmas, batch, createdBy, now) {
      if (lemmas.length === 0) return []
      const fresh = lemmas.map((lemma) => ({
        id: crypto.randomUUID() as EntryId,
        lemma,
        createdBy: createdBy as PrincipalRef,
        createdAt: now,
      }))
      await db.batch([
        db.insert(entries).values(fresh).onConflictDoNothing(),
        ...fresh.map((entry) => insertWorklistRow(db, entry)),
      ])
      const rows = await db
        .select()
        .from(entries)
        .where(inIds(entries.lemma, [...lemmas]))
      const ids = rows.map((row) => row.id)
      await db
        .update(worklist)
        .set({ live: true, batch: sql`coalesce(${worklist.batch}, ${batch})`, ...bumpRevision })
        .where(inIds(worklist.entryId, ids))
      return rows.map(toEntry)
    },

    async setPhrasesLive(live, dead, batch) {
      // A dropped phrase stays live while another published phrases list still names it.
      const named = sql`exists (select 1 from facts as list, json_each(list.payload, '$.phrases') as phrase where list.kind = 'phrases' and list.status = 'published' and phrase.value = ${entries.lemma})`
      const stillNamed = db
        .select({ id: entries.id })
        .from(entries)
        .where(and(inIds(entries.id, [...dead]), named))
      await db.batch([
        db
          .update(worklist)
          .set({ live: true, batch: sql`coalesce(${worklist.batch}, ${batch})`, ...bumpRevision })
          .where(inIds(worklist.entryId, [...live])),
        db
          .update(worklist)
          .set({ live: false, ...bumpRevision })
          .where(and(inIds(worklist.entryId, [...dead]), sql`${worklist.entryId} not in (${stillNamed})`)),
      ])
    },

    async loadEntrySnapshot(entry) {
      const own = sensesOf(entry.id)
      const ownFacts = db.select({ id: facts.id }).from(facts).where(inArray(facts.subjectId, own))
      const outgoingTargets = db
        .select({ id: facts.objectId })
        .from(facts)
        .where(and(eq(facts.kind, 'relation'), inArray(facts.subjectId, own)))
      const incomingSources = db
        .select({ id: facts.subjectId })
        .from(facts)
        .where(and(eq(facts.kind, 'relation'), inArray(facts.objectId, own)))
      const neighborEntries = db
        .select({ id: senses.entryId })
        .from(senses)
        .where(
          and(
            or(inArray(senses.id, outgoingTargets), inArray(senses.id, incomingSources)),
            ne(senses.entryId, entry.id),
          ),
        )
      const order = [asc(facts.createdAt), asc(facts.id)]

      const [work, ownSenses, subjectFacts, incoming, neighbors, inventories, passes, family] = await db.batch([
        db
          .select({ live: worklist.live, batch: worklist.batch, levelRank: worklist.levelRank, zipf: worklist.zipf })
          .from(worklist)
          .where(eq(worklist.entryId, entry.id)),
        db.select().from(senses).where(eq(senses.entryId, entry.id)).orderBy(asc(senses.createdAt), asc(senses.id)),
        db
          .select()
          .from(facts)
          .where(or(eq(facts.subjectId, entry.id), inArray(facts.subjectId, own), inArray(facts.subjectId, ownFacts)))
          .orderBy(...order),
        db
          .select()
          .from(facts)
          .where(and(eq(facts.kind, 'relation'), inArray(facts.objectId, own)))
          .orderBy(...order),
        db
          .select({ id: entries.id, lemma: entries.lemma, live: worklist.live })
          .from(entries)
          .innerJoin(worklist, eq(worklist.entryId, entries.id))
          .where(inArray(entries.id, neighborEntries)),
        db
          .select()
          .from(facts)
          .where(and(eq(facts.kind, 'senses'), inArray(facts.subjectId, neighborEntries)))
          .orderBy(...order),
        db
          .select({ type: workPasses.type, subjectId: workPasses.subjectId })
          .from(workPasses)
          .where(eq(workPasses.entryId, entry.id)),
        familyOf(db, entry),
      ])

      const [row] = work
      if (!row) throw new Error(`Entry ${entry.id} has no worklist row.`)
      return {
        entry: { ...entry, live: row.live },
        batch: row.batch,
        levelRank: row.levelRank,
        zipf: row.zipf,
        family: family.map((member) => member.lemma),
        senses: ownSenses.map(toSense),
        facts: subjectFacts.map(toFact),
        incoming: incoming.map(toFact),
        passes: new Set(passes.map((pass) => passKey(workTypeSchema.parse(pass.type), pass.subjectId))),
        neighbors: {
          inventories: inventories.map(toFact),
          lemmas: new Map(neighbors.map((neighbor) => [neighbor.id as EntryId, neighbor.lemma])),
          liveEntries: new Set(neighbors.filter((neighbor) => neighbor.live).map((neighbor) => neighbor.id as EntryId)),
        },
      }
    },

    async listEntrySummaries(filter, request, now) {
      const [rows, entryFacts, senseFacts, items] = await db.batch(entrySummaryStatements(db, filter, request, now))

      const factCounts = new Map<string, Record<FactStatus, number>>()
      for (const row of [...entryFacts, ...senseFacts]) {
        const counts = factCounts.get(row.entryId) ?? noFacts()
        counts[factStatusSchema.parse(row.status)] += row.count
        factCounts.set(row.entryId, counts)
      }
      const work = new Map<string, ReturnType<typeof noWork>>()
      for (const row of items) {
        const counts = work.get(row.entryId) ?? noWork()
        const status = openItemStatus({ ...row, leased: row.leased === 1 })
        if (status !== 'queued') counts[status] += row.count
        counts.total += row.count
        work.set(row.entryId, counts)
      }
      // lemma is unique, so it is its own keyset tiebreaker.
      return page(
        rows,
        request.limit,
        (row) => ({
          id: row.id as EntryId,
          lemma: row.lemma,
          live: row.live,
          sense_count: row.senseCount ?? 0,
          fact_counts: factCounts.get(row.id) ?? noFacts(),
          last_worked_at: row.lastWorkedAt,
          created_at: row.createdAt,
          level: levelOfRank(row.levelRank),
          completeness: row.completeness,
          credibility: row.credibility,
          slots: { total: row.slotsTotal, published: row.slotsPublished, pending: row.slotsPending },
          open_work: work.get(row.id) ?? noWork(),
        }),
        (row) => ({ lemma: row.lemma }),
      )
    },

    async findLiveForms(contentKeys) {
      // A labelled key extends the unlabelled one with `|…`; `}` is the character after `|`, so
      // the range stays on the content index.
      const keyOrLabelled = (key: string) =>
        or(eq(facts.contentKey, key), and(gt(facts.contentKey, `${key}|`), lt(facts.contentKey, `${key}}`)))
      const rows = await db
        .select({ entry: entries, fact: facts })
        .from(facts)
        .innerJoin(entries, eq(entries.id, facts.subjectId))
        .where(
          and(
            eq(facts.kind, 'form'),
            or(...contentKeys.map(keyOrLabelled)),
            inArray(facts.status, ['pending', 'published']),
            liveEntryOf(entries.id, db),
          ),
        )
        .orderBy(asc(entries.lemma), asc(facts.id))
      return rows.map((row) => ({ entry: toEntry(row.entry), fact: toFact(row.fact) as FactOf<'form'> }))
    },

    async listLiveCaseVariants({ id, lemma }) {
      const rows = await db
        .select({ lemma: entries.lemma })
        .from(entries)
        // Matches the expression of entries_lemma_case_idx so SQLite reads it through the index.
        .where(and(sql`lower(${entries.lemma}) = lower(${lemma})`, ne(entries.id, id), liveEntryOf(entries.id, db)))
        .orderBy(asc(entries.lemma))
      return rows.map((row) => row.lemma as Lemma)
    },
  }
}
