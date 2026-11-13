import { entries, type FactRow, facts, senses, worklist } from '@server/db/schema'
import type { Fact, FactOf } from '@server/domain/fact'
import { factKinds, type Link } from '@server/domain/fact-kinds'
import { levelRank } from '@server/domain/reference'
import type { Lemma } from '@server/domain/term'
import type { FactRepo, WithEntry } from '@server/usecases/ports'
import {
  CURATOR,
  type EntryId,
  type FactId,
  type FactKind,
  factKindSchema,
  factStatusSchema,
  type SenseId,
} from '@shared/facts'
import type { CefrLevel } from '@shared/reference'
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  lt,
  ne,
  notExists,
  or,
  type SQLWrapper,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { type Db, decodeCursor, factSelectValues, fromFact, guardUnique, liveStatus, page, toFact } from './rows'
import { touchLinkedWorkOfFact, touchWorkOf, touchWorkOfFact } from './work'

/** The facts about an entry, or a sense of an entry, whose lowest CEFR level is this. */
function aboutLevel(db: Db, level: CefrLevel) {
  const entryOfSubject = entryOf(db, facts.subjectId)
  return exists(
    db
      .select({ one: sql`1` })
      .from(worklist)
      .where(and(eq(worklist.entryId, entryOfSubject), eq(worklist.levelRank, levelRank(level)))),
  )
}

/**
 * The entry a subject id is or belongs to: an entry, a sense's entry, for a translation of a
 * collocation the entry of that fact's sense, and for a sentence (which entries share) the entry of
 * its oldest example, else the headword of the oldest phrases list naming it a saying.
 */
export function entryOf(db: Db, subjectId: SQLWrapper) {
  const sense = alias(senses, 'of_sense')
  const translated = alias(facts, 'of_fact')
  const factSense = alias(senses, 'of_fact_sense')
  return sql`case when exists (select 1 from sentences where sentences.id = ${subjectId}) then coalesce(
    (select s.entry_id from facts as ex join senses as s on s.id = ex.subject_id where ex.kind = 'example' and ex.object_id = ${subjectId} order by ex.created_at, ex.id limit 1),
    (select list.subject_id from facts as list where list.kind = 'phrases' and instr(list.payload, ${subjectId}) > 0 order by list.created_at, list.id limit 1)
  ) else coalesce(
    (${db.select({ entryId: sense.entryId }).from(sense).where(eq(sense.id, subjectId))}),
    (${db.select({ entryId: factSense.entryId }).from(translated).innerJoin(factSense, eq(factSense.id, translated.subjectId)).where(eq(translated.id, subjectId))}),
    ${subjectId}
  ) end`
}

const subjectEntry = alias(entries, 'subject_entry')

/** Facts joined to the entry their subject is or belongs to. */
function withEntry(db: Db) {
  return db
    .select({ fact: facts, entryId: subjectEntry.id, lemma: subjectEntry.lemma })
    .from(facts)
    .innerJoin(subjectEntry, eq(subjectEntry.id, entryOf(db, facts.subjectId)))
}

const toFactWithEntry = (row: { fact: FactRow; entryId: string; lemma: string }): WithEntry<Fact> => ({
  ...toFact(row.fact),
  entry: { id: row.entryId as EntryId, lemma: row.lemma as Lemma },
})

/** The facts about the entry with exactly this lemma or one of its senses; no entry, no facts. */
function aboutLemma(db: Db, lemma: string) {
  const entry = db.select({ id: entries.id }).from(entries).where(eq(entries.lemma, lemma))
  return inArray(entryOf(db, facts.subjectId), entry)
}

const factCursor = z.object({ created_at: z.string(), id: z.string() })
const UNIQUE_MESSAGES = {
  'facts.supersedes_id':
    'The fact this corrects already has a live correction; retract that one or wait for its review.',
  'facts.': 'Another live fact already holds this slot.',
}

/**
 * The number of live facts of a kind about a subject, not counting the fact a correction
 * supersedes: the correction takes that fact's place rather than adding one.
 */
function heldLive(db: Db, kind: SQLWrapper | FactKind, subjectId: SQLWrapper | string, excluding: FactId | null) {
  const held = alias(facts, 'held')
  return db
    .select({ count: count() })
    .from(held)
    .where(
      and(
        eq(held.subjectId, subjectId),
        eq(held.kind, kind),
        inArray(held.status, ['pending', 'published']),
        excluding ? ne(held.id, excluding) : undefined,
      ),
    )
}

/** The given fact, while it is published. */
function publishedFact(db: Db, id: FactId) {
  const original = alias(facts, 'original')
  return db
    .select({ one: sql`1` })
    .from(original)
    .where(and(eq(original.id, id), eq(original.status, 'published')))
}

/**
 * The insert of a new fact. A kind with `maxLive` inserts only while the subject holds fewer live
 * facts of the kind, and a correction only while its original is published, both checked in the
 * same statement so no concurrent write can slip between the check and the insert.
 */
function insertFact(db: Db, fact: Fact) {
  const { maxLive } = factKinds[fact.kind]
  const condition = and(
    maxLive === undefined
      ? undefined
      : sql`(${heldLive(db, fact.kind, fact.subjectId, fact.supersedesId)}) < ${maxLive}`,
    fact.supersedesId ? exists(publishedFact(db, fact.supersedesId)) : undefined,
  )
  if (!condition) return db.insert(facts).values(fromFact(fact)).onConflictDoNothing()
  const values = db.select(factSelectValues(fact)).from(sql`(select 1)`).where(condition)
  return db
    .insert(facts)
    .select(values as never)
    .onConflictDoNothing()
}

/** A live fact that supersedes the given one. */
function liveCorrectionOf(db: Db, id: SQLWrapper) {
  const correction = alias(facts, 'live_correction')
  return db
    .select({ one: sql`1` })
    .from(correction)
    .where(and(eq(correction.supersedesId, id), inArray(correction.status, ['pending', 'published'])))
}

export function createFactRepo(db: Db): FactRepo {
  const findLive: FactRepo['findLive'] = async (kind, subjectId, contentKey) => {
    const row = await db
      .select()
      .from(facts)
      .where(and(eq(facts.kind, kind), eq(facts.contentKey, contentKey), eq(facts.subjectId, subjectId), liveStatus))
      .get()
    return row ? toFact(row) : null
  }

  return {
    async find(id) {
      const row = await db.select().from(facts).where(eq(facts.id, id)).get()
      return row ? toFact(row) : null
    },

    async findWithEntry(id) {
      const row = await withEntry(db).where(eq(facts.id, id)).get()
      return row ? toFactWithEntry(row) : null
    },

    findLive,

    async listLive(kind, subjectId) {
      const rows = await db
        .select()
        .from(facts)
        .where(and(eq(facts.subjectId, subjectId), eq(facts.kind, kind), liveStatus))
        .orderBy(asc(facts.createdAt), asc(facts.id))
      return rows.map(toFact)
    },

    async listLiveLinks<K extends FactKind>(kind: K, between: readonly [EntryId, EntryId]): Promise<Link<K>[]> {
      const subjectSense = alias(senses, 'subject_sense')
      const targetSense = alias(senses, 'target_sense')
      const rows = await db
        .select({ fact: facts, subjectEntry: subjectSense.entryId, targetEntry: targetSense.entryId })
        .from(facts)
        .innerJoin(subjectSense, eq(subjectSense.id, facts.subjectId))
        .innerJoin(targetSense, eq(targetSense.id, facts.objectId))
        .where(
          and(
            eq(facts.kind, kind),
            liveStatus,
            inArray(subjectSense.entryId, [...between]),
            inArray(targetSense.entryId, [...between]),
            ne(subjectSense.entryId, targetSense.entryId),
          ),
        )
      return rows.map(({ fact, subjectEntry, targetEntry }) => {
        const { id, payload, subjectId, objectId } = toFact(fact) as FactOf<K>
        return {
          id,
          payload,
          subject: { sense: subjectId as SenseId, entry: subjectEntry as EntryId },
          target: { sense: objectId as SenseId, entry: targetEntry as EntryId },
        }
      })
    },

    async findLiveCorrection(id) {
      const row = await db
        .select()
        .from(facts)
        .where(and(eq(facts.supersedesId, id), liveStatus))
        .get()
      return row ? toFact(row) : null
    },

    async insert(fact) {
      // The partial unique indexes turn a concurrent duplicate, a taken exclusive slot, or a second
      // live correction of one original into a no-op: a live fact with the same content wins, and
      // otherwise the holder does.
      await db.batch([
        insertFact(db, fact),
        touchWorkOf(db, fact.objectId ? [fact.subjectId, fact.objectId] : [fact.subjectId]),
        touchLinkedWorkOfFact(db, fact.id),
      ])
      return findLive(fact.kind, fact.subjectId, fact.contentKey)
    },

    async transition({ id, from, to, at, review, supersede, liveBelow, unsuperseded, originalPublished }) {
      const update = db
        .update(facts)
        .set({ status: to, updatedAt: at, ...(review ? { review: JSON.stringify(review) } : {}) })
        .where(
          and(
            eq(facts.id, id),
            inArray(facts.status, [...from]),
            liveBelow === undefined
              ? undefined
              : sql`(${heldLive(db, facts.kind, facts.subjectId, liveBelow.excluding)}) < ${liveBelow.max}`,
            unsuperseded ? notExists(liveCorrectionOf(db, facts.id)) : undefined,
            originalPublished ? exists(publishedFact(db, originalPublished)) : undefined,
          ),
        )
        .returning({ id: facts.id })
      // Any status or review change can change the gaps or public view at either end; a correction
      // has its original's subject, so the same rows cover the original it supersedes.
      const sync = [touchWorkOfFact(db, id), touchLinkedWorkOfFact(db, id)]
      if (!supersede) {
        return guardUnique(UNIQUE_MESSAGES, async () => {
          const [updated] = await db.batch([update, ...sync])
          return updated.length > 0
        })
      }

      // One batch, correction after the original: the original leaves `published` only while this
      // correction is still pending, so a duplicate delivery changes nothing and the correction
      // never enters `published` beside the original.
      const correction = alias(facts, 'correction')
      const stillPending = exists(
        db
          .select({ one: sql`1` })
          .from(correction)
          .where(
            and(eq(correction.id, id), inArray(correction.status, [...from]), eq(correction.supersedesId, supersede)),
          ),
      )
      const retire = db
        .update(facts)
        .set({ status: 'superseded', updatedAt: at })
        .where(and(eq(facts.id, supersede), eq(facts.status, 'published'), stillPending))
      const statements = [retire, update, ...sync] as const
      const results = await guardUnique(UNIQUE_MESSAGES, () => db.batch(statements))
      return (results[statements.indexOf(update)] as { id: string }[]).length > 0
    },

    async findRejected(kind, subjectId, contentKey) {
      const row = await db
        .select()
        .from(facts)
        .where(
          and(
            eq(facts.kind, kind),
            eq(facts.subjectId, subjectId),
            eq(facts.contentKey, contentKey),
            eq(facts.status, 'rejected'),
          ),
        )
        .orderBy(desc(facts.updatedAt))
        .get()
      return row ? toFact(row) : null
    },

    async claimStuckBefore(cutoff, limit, at) {
      const pending = await db
        .select({ id: facts.id })
        .from(facts)
        .where(
          and(
            eq(facts.status, 'pending'),
            lt(facts.updatedAt, cutoff),
            or(isNull(facts.reviewEnqueuedAt), lt(facts.reviewEnqueuedAt, cutoff)),
          ),
        )
        .orderBy(asc(facts.updatedAt))
        .limit(limit)
      const ids = pending.map((row) => row.id as FactId)
      if (ids.length > 0) {
        await db
          .update(facts)
          .set({ reviewEnqueuedAt: at })
          .where(and(inArray(facts.id, ids), eq(facts.status, 'pending')))
      }
      return ids
    },

    async findCuratedRejection(kind, subjectId, contentKey) {
      const row = await db
        .select()
        .from(facts)
        .where(
          and(
            eq(facts.kind, kind),
            eq(facts.contentKey, contentKey),
            eq(facts.subjectId, subjectId),
            eq(facts.status, 'rejected'),
            sql`json_extract(${facts.review}, '$.reviewer') = ${CURATOR}`,
          ),
        )
        .get()
      return row ? toFact(row) : null
    },

    async list({ status, kind, author, lemma, level }, { limit, cursor }) {
      const after = cursor ? decodeCursor(cursor, factCursor) : undefined
      const rows = await withEntry(db)
        .where(
          and(
            status ? eq(facts.status, status) : undefined,
            kind ? eq(facts.kind, kind) : undefined,
            author ? eq(facts.author, author) : undefined,
            lemma ? aboutLemma(db, lemma) : undefined,
            level ? aboutLevel(db, level) : undefined,
            after
              ? or(
                  lt(facts.createdAt, after.created_at),
                  and(eq(facts.createdAt, after.created_at), lt(facts.id, after.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(facts.createdAt), desc(facts.id))
        .limit(limit + 1)
      return page(rows, limit, toFactWithEntry, (row) => ({ created_at: row.fact.createdAt, id: row.fact.id }))
    },

    async countByKindAndStatus() {
      const rows = await db
        .select({ kind: facts.kind, status: facts.status, count: count() })
        .from(facts)
        .groupBy(facts.kind, facts.status)
        .orderBy(asc(facts.kind), asc(facts.status))
      return rows.map((row) => ({
        kind: factKindSchema.parse(row.kind),
        status: factStatusSchema.parse(row.status),
        count: row.count,
      }))
    },
  }
}
