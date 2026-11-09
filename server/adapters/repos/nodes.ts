import { entries, facts, senses } from '@server/db/schema'
import type { FactOf } from '@server/domain/fact'
import type { SenseWithLemma } from '@server/domain/nodes'
import type { Lemma } from '@server/domain/term'
import type { NodeRepo } from '@server/usecases/ports'
import type { EntryId } from '@shared/facts'
import { and, asc, eq, exists, gt, gte, inArray, lt, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { type Db, decodeCursor, liveStatus, page, toEntry, toFact, toSense } from './rows'

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

function publishedEntry(entryId: SQL | typeof entries.id, db: Db) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(facts)
      .where(and(eq(facts.kind, 'entry'), eq(facts.subjectId, entryId), eq(facts.status, 'published'))),
  )
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
      await db.insert(entries).values(entry).onConflictDoNothing()
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

    async findSenseByGloss(entryId, pos, contentKey) {
      const row = await db
        .select({ sense: senses, fact: facts })
        .from(senses)
        .innerJoin(
          facts,
          and(eq(facts.kind, 'sense'), eq(facts.contentKey, contentKey), eq(facts.subjectId, senses.id), liveStatus),
        )
        .where(and(eq(senses.entryId, entryId), eq(senses.pos, pos)))
        .get()
      return row ? { sense: toSense(row.sense), fact: toFact(row.fact) } : null
    },

    async insertSenseWithFact(sense, fact) {
      await db.batch([
        db.insert(senses).values(sense),
        db.insert(facts).values({ ...fact, payload: JSON.stringify(fact.payload), review: null }),
      ])
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
            prefix ? and(gte(entries.lemma, prefix), lt(entries.lemma, `${prefix}${PREFIX_END}`)) : undefined,
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
