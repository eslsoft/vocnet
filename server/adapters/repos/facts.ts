import { entries, facts, senses, worklist } from '@server/db/schema'
import type { Fact, FactOf } from '@server/domain/fact'
import { factKinds, type Link, type Rereview } from '@server/domain/fact-kinds'
import { factTransitions } from '@server/domain/fact-lifecycle'
import { levelRank } from '@server/domain/reference'
import type { FactRepo } from '@server/usecases/ports'
import {
  CURATOR,
  type EntryId,
  type FactId,
  type FactKind,
  type FactStatus,
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

/** A live fact of the outer fact's kind about its subject with its content, which a rejected attempt is then no longer. */
function liveAgain(db: Db) {
  const held = alias(facts, 'held')
  return db
    .select({ one: sql`1` })
    .from(held)
    .where(
      and(
        eq(held.kind, facts.kind),
        eq(held.subjectId, facts.subjectId),
        eq(held.contentKey, facts.contentKey),
        inArray(held.status, ['pending', 'published']),
      ),
    )
}

/**
 * The fact was not settled by a curator. Every statement that marks facts for revalidation carries
 * it, the migrations that re-judge facts after a rule change included: a curator's verdict is final.
 */
const notCurated = sql`coalesce(json_extract(${facts.review}, '$.reviewer'), '') <> ${CURATOR}`

/** The facts about an entry, or a sense of an entry, whose lowest CEFR level is this. */
function aboutLevel(db: Db, level: CefrLevel) {
  const sense = alias(senses, 'level_sense')
  const entryOfSubject = sql`coalesce((${db.select({ entryId: sense.entryId }).from(sense).where(eq(sense.id, facts.subjectId))}), ${facts.subjectId})`
  return exists(
    db
      .select({ one: sql`1` })
      .from(worklist)
      .where(and(eq(worklist.entryId, entryOfSubject), eq(worklist.levelRank, levelRank(level)))),
  )
}

/** Published facts whose standing review is uncertain or failed: the weak facts the reviews leave. */
const weakReview = and(
  eq(facts.status, 'published'),
  sql`json_extract(${facts.review}, '$.verdict') in ('uncertain', 'fail')`,
)

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
        // Only facts this reviewer chain settled; a curated fact never matches.
        sql`json_extract(${facts.review}, '$.reviewer') = ${rereview.settledBy}`,
      ),
    )
}

/** A live fact of `kind` about the node `nodeId` names: a gloss for a sense, an entry fact for an entry. */
function liveDefining(db: Db, kind: 'entry' | 'sense', nodeId: AnySQLiteColumn) {
  const defining = alias(facts, `live_${kind}`)
  return db
    .select({ one: sql`1` })
    .from(defining)
    .where(
      and(eq(defining.kind, kind), eq(defining.subjectId, nodeId), inArray(defining.status, ['pending', 'published'])),
    )
}

/**
 * Retracts the live links (facts with an object sense) at a sense the written entry or sense fact
 * defines, or of the entry it defines, that can no longer show: no live gloss, or no live entry
 * fact. A link to such a sense fills nothing and shows nothing, yet would hold its content key, so
 * a producer could neither see the gap as open nor resubmit it. Batch it after the status write;
 * a fact of any other kind, or a node that still shows, retracts nothing. Curated links go too:
 * their verdict judged the claim, and the end it named is gone.
 */
function retireDeadLinks(db: Db, writtenId: FactId, at: string) {
  const written = alias(facts, 'written_node')
  const defined = db
    .select({ id: written.subjectId })
    .from(written)
    .where(and(eq(written.id, writtenId), inArray(written.kind, ['entry', 'sense'])))
  const dead = db
    .select({ id: senses.id })
    .from(senses)
    .where(
      and(
        or(inArray(senses.id, defined), inArray(senses.entryId, defined)),
        or(notExists(liveDefining(db, 'sense', senses.id)), notExists(liveDefining(db, 'entry', senses.entryId))),
      ),
    )
  const { from, to } = factTransitions.retract
  return db
    .update(facts)
    .set({ status: to, updatedAt: at, revalidateSince: null })
    .where(
      and(
        isNotNull(facts.objectId),
        inArray(facts.status, [...from]),
        or(inArray(facts.subjectId, dead), inArray(facts.objectId, dead)),
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
      // A sense or entry that can no longer show takes its links out of live first, so the rescore
      // and the linked entries' rows see them gone.
      const sync = [retireDeadLinks(db, id, at), syncLive, touchWorkOfFact(db, id), touchLinkedWorkOfFact(db, id)]
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
                  notCurated,
                  stillPending,
                ),
              ),
          ]
        : []
      const statements = [retire, ...mark, update, ...rereviews, ...sync] as const
      const results = await guardUnique(UNIQUE_MESSAGES, () => db.batch(statements))
      return (results[statements.indexOf(update)] as { id: string }[]).length > 0
    },

    async listRejected(nodeId, kinds, limit) {
      const rows = await db
        .select()
        .from(facts)
        .where(
          and(
            eq(facts.status, 'rejected'),
            inArray(facts.kind, [...kinds]),
            or(eq(facts.subjectId, nodeId), eq(facts.objectId, nodeId)),
            notExists(liveAgain(db)),
          ),
        )
        .orderBy(desc(facts.updatedAt), desc(facts.id))
        .limit(limit)
      return rows.map(toFact)
    },

    async listRejectedDerivations(baseLemma, limit) {
      const rows = await db
        .select({ word: entries.lemma, fact: facts })
        .from(facts)
        .innerJoin(entries, eq(entries.id, facts.subjectId))
        .where(
          and(
            eq(facts.kind, 'morphology'),
            eq(facts.status, 'rejected'),
            sql`instr(${facts.payload}, ${JSON.stringify(baseLemma)}) > 0`,
            sql`exists (select 1 from json_each(${facts.payload}, '$.parts') where json_extract(value, '$.role') = 'base' and json_extract(value, '$.lemma') = ${baseLemma})`,
            notExists(liveAgain(db)),
          ),
        )
        .orderBy(desc(facts.updatedAt), desc(facts.id))
        .limit(limit)
      return rows.map(({ word, fact }) => ({ word, fact: toFact(fact) as FactOf<'morphology'> }))
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
      // Pending facts come first: a revalidation backlog of old published facts must never
      // starve a pending fact whose enqueue was lost, since pending facts block their entry's claim.
      const pending = await db
        .select({ id: facts.id })
        .from(facts)
        .where(and(eq(facts.status, 'pending'), lt(facts.updatedAt, cutoff)))
        .orderBy(asc(facts.updatedAt))
        .limit(limit)
      const room = limit - pending.length
      const revalidating =
        room > 0
          ? await db
              .select({ id: facts.id })
              .from(facts)
              .where(and(eq(facts.status, 'published'), lt(facts.revalidateSince, cutoff)))
              .orderBy(asc(facts.revalidateSince))
              .limit(room)
          : []
      return [...pending, ...revalidating].map((row) => row.id as FactId)
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

    async list({ status, kind, weak, level }, { limit, cursor }) {
      const after = cursor ? decodeCursor(cursor, factCursor) : undefined
      const rows = await db
        .select()
        .from(facts)
        .where(
          and(
            status ? eq(facts.status, status) : undefined,
            kind ? eq(facts.kind, kind) : undefined,
            weak ? weakReview : undefined,
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
