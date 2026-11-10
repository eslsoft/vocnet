import { entries, facts } from '@server/db/schema'
import type { Fact } from '@server/domain/fact'
import { factKinds, type Rereview } from '@server/domain/fact-kinds'
import type { FactRepo } from '@server/usecases/ports'
import { type FactId, type FactKind, type FactStatus, factKindSchema, factStatusSchema } from '@shared/facts'
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notExists,
  notInArray,
  or,
  type SQLWrapper,
  sql,
} from 'drizzle-orm'
import { type AnySQLiteColumn, alias } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { type Db, decodeCursor, factSelectValues, fromFact, guardUnique, liveStatus, page, toFact } from './rows'
import { syncWorklistLive, touchLinkedWorkOfFact, touchWorkOf, touchWorkOfFact } from './work'

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

/**
 * Marks for a review in place the facts a `Rereview` names, once the write it accompanies has
 * applied: the written fact holds its new status and timestamp only if that write ran in this batch.
 * The entry the written fact is about is never the other entry.
 */
function markRereview(db: Db, rereview: Rereview, written: { id: FactId; to: FactStatus; at: string }) {
  const writtenFact = alias(facts, 'written')
  const applied = db
    .select({ subjectId: writtenFact.subjectId })
    .from(writtenFact)
    .where(
      and(eq(writtenFact.id, written.id), eq(writtenFact.status, written.to), eq(writtenFact.updatedAt, written.at)),
    )
  const otherEntry = db
    .select({ id: entries.id })
    .from(entries)
    .where(and(eq(entries.lemma, rereview.lemma), exists(applied), notInArray(entries.id, applied)))
  return db
    .update(facts)
    .set({ revalidateSince: written.at })
    .where(
      and(
        inArray(facts.subjectId, otherEntry),
        eq(facts.kind, rereview.kind),
        eq(facts.status, 'published'),
        isNull(facts.revalidateSince),
        sql`json_extract(${facts.review}, '$.reviewer') = ${rereview.settledBy}`,
      ),
    )
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

    findLive,

    async listLive(kind, subjectId) {
      const rows = await db
        .select()
        .from(facts)
        .where(and(eq(facts.subjectId, subjectId), eq(facts.kind, kind), liveStatus))
        .orderBy(asc(facts.createdAt), asc(facts.id))
      return rows.map(toFact)
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
        syncWorklistLive(db, [fact.subjectId]),
        touchWorkOf(db, fact.objectId ? [fact.subjectId, fact.objectId] : [fact.subjectId]),
        touchLinkedWorkOfFact(db, fact.id),
      ])
      return findLive(fact.kind, fact.subjectId, fact.contentKey)
    },

    async transition({
      id,
      from,
      to,
      at,
      review,
      supersede,
      revalidate,
      revalidateSince,
      liveBelow,
      unsuperseded,
      originalPublished,
      rereview,
    }) {
      // The review read the fact's revalidation mark; a newer mark means a newer review is due, so
      // neither the correction nor the original it retires may move on this one.
      const sameMark = (mark: AnySQLiteColumn) =>
        revalidateSince === undefined ? undefined : revalidateSince === null ? isNull(mark) : eq(mark, revalidateSince)
      const update = db
        .update(facts)
        .set({
          status: to,
          updatedAt: at,
          revalidateSince: null,
          ...(review ? { review: JSON.stringify(review) } : {}),
        })
        .where(
          and(
            eq(facts.id, id),
            inArray(facts.status, [...from]),
            sameMark(facts.revalidateSince),
            liveBelow === undefined
              ? undefined
              : sql`(${heldLive(db, facts.kind, facts.subjectId, liveBelow.excluding)}) < ${liveBelow.max}`,
            unsuperseded ? notExists(liveCorrectionOf(db, facts.id)) : undefined,
            originalPublished ? exists(publishedFact(db, originalPublished)) : undefined,
          ),
        )
        .returning({ id: facts.id })
      const syncLive = syncWorklistLive(db, db.select({ id: facts.subjectId }).from(facts).where(eq(facts.id, id)))
      // Any status or review change can change the gaps, weak facts, or public view at either end;
      // a correction has its original's subject, so the same rows cover the original it supersedes.
      // An entry or sense fact moving into or out of live or published, or a gloss correction
      // publishing, also changes the entries whose relations link to its node: their gaps and the
      // relations their public views show.
      const sync = [syncLive, touchWorkOfFact(db, id), touchLinkedWorkOfFact(db, id)]
      const rereviews = rereview ? [markRereview(db, rereview, { id, to, at })] : []
      if (!supersede) {
        return guardUnique(UNIQUE_MESSAGES, async () => {
          const [updated] = await db.batch([update, ...rereviews, ...sync])
          return updated.length > 0
        })
      }

      // One batch, correction last before the worklist sync: the original leaves `published` and
      // its live dependents are marked only while this correction is still pending, so a duplicate
      // delivery changes nothing and the correction never enters `published` beside the original.
      const correction = alias(facts, 'correction')
      const stillPending = exists(
        db
          .select({ one: sql`1` })
          .from(correction)
          .where(
            and(
              eq(correction.id, id),
              inArray(correction.status, [...from]),
              eq(correction.supersedesId, supersede),
              sameMark(correction.revalidateSince),
            ),
          ),
      )
      const retire = db
        .update(facts)
        .set({ status: 'superseded', updatedAt: at, revalidateSince: null })
        .where(and(eq(facts.id, supersede), eq(facts.status, 'published'), stillPending))
      const mark = revalidate
        ? [
            db
              .update(facts)
              .set({ revalidateSince: at })
              .where(
                and(
                  liveStatus,
                  inArray(facts.kind, [...revalidate.kinds]),
                  or(eq(facts.subjectId, revalidate.nodeId), eq(facts.objectId, revalidate.nodeId)),
                  stillPending,
                ),
              ),
          ]
        : []
      const statements = [retire, ...mark, update, ...rereviews, ...sync] as const
      const results = await guardUnique(UNIQUE_MESSAGES, () => db.batch(statements))
      return (results[statements.indexOf(update)] as { id: string }[]).length > 0
    },

    async listRevalidating(nodeId) {
      const rows = await db
        .select({ id: facts.id })
        .from(facts)
        .where(
          and(
            liveStatus,
            isNotNull(facts.revalidateSince),
            or(eq(facts.subjectId, nodeId), eq(facts.objectId, nodeId)),
          ),
        )
      return rows.map((row) => row.id as FactId)
    },

    async listStuckBefore(cutoff, limit) {
      const rows = await db
        .select({ id: facts.id })
        .from(facts)
        .where(
          or(
            and(eq(facts.status, 'pending'), lt(facts.updatedAt, cutoff)),
            and(eq(facts.status, 'published'), lt(facts.revalidateSince, cutoff)),
          ),
        )
        .orderBy(asc(facts.updatedAt))
        .limit(limit)
      return rows.map((row) => row.id as FactId)
    },

    async list({ status, kind }, { limit, cursor }) {
      const after = cursor ? decodeCursor(cursor, factCursor) : undefined
      const rows = await db
        .select()
        .from(facts)
        .where(
          and(
            status ? eq(facts.status, status) : undefined,
            kind ? eq(facts.kind, kind) : undefined,
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
      return page(rows, limit, toFact, (row) => ({ created_at: row.createdAt, id: row.id }))
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
