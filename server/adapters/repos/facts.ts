import { facts } from '@server/db/schema'
import type { FactRepo } from '@server/usecases/ports'
import { type FactId, factKindSchema, factStatusSchema } from '@shared/facts'
import { and, asc, count, desc, eq, exists, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { type Db, decodeCursor, fromFact, guardUnique, liveStatus, page, toFact } from './rows'
import { syncWorklistLive } from './work'

const factCursor = z.object({ created_at: z.string(), id: z.string() })
const SLOT_TAKEN = 'Another live fact already holds this slot.'

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

    async insert(fact) {
      // The partial unique indexes turn a concurrent duplicate or a taken exclusive slot into a
      // no-op: a live fact with the same content wins, and otherwise the slot holder does.
      await db.batch([
        db.insert(facts).values(fromFact(fact)).onConflictDoNothing(),
        syncWorklistLive(db, [fact.subjectId]),
      ])
      return findLive(fact.kind, fact.subjectId, fact.contentKey)
    },

    async transition({ id, from, to, at, review, supersede, revalidate, revalidateSince }) {
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
            revalidateSince ? eq(facts.revalidateSince, revalidateSince) : undefined,
          ),
        )
        .returning({ id: facts.id })
      const syncLive = syncWorklistLive(db, db.select({ id: facts.subjectId }).from(facts).where(eq(facts.id, id)))
      if (!supersede) {
        return guardUnique('facts', SLOT_TAKEN, async () => {
          const [updated] = await db.batch([update, syncLive])
          return updated.length > 0
        })
      }

      // One batch, correction last before the worklist sync: the original leaves `published` and
      // its dependents are marked only while this correction is still pending, so a duplicate
      // delivery changes nothing and the correction never enters `published` beside the original.
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
        .set({ status: 'superseded', updatedAt: at, revalidateSince: null })
        .where(and(eq(facts.id, supersede), eq(facts.status, 'published'), stillPending))
      const mark = revalidate
        ? [
            db
              .update(facts)
              .set({ revalidateSince: at })
              .where(
                and(
                  eq(facts.status, 'published'),
                  inArray(facts.kind, [...revalidate.kinds]),
                  or(eq(facts.subjectId, revalidate.nodeId), eq(facts.objectId, revalidate.nodeId)),
                  stillPending,
                ),
              ),
          ]
        : []
      const results = await guardUnique('facts', SLOT_TAKEN, () => db.batch([retire, ...mark, update, syncLive]))
      return (results.at(-2) as { id: string }[]).length > 0
    },

    async listRevalidating(nodeId) {
      const rows = await db
        .select({ id: facts.id })
        .from(facts)
        .where(
          and(
            eq(facts.status, 'published'),
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
