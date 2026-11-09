import { facts } from '@server/db/schema'
import type { FactRepo } from '@server/usecases/ports'
import { type FactId, factKindSchema, factStatusSchema } from '@shared/facts'
import { and, asc, count, desc, eq, exists, inArray, lt, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { type Db, decodeCursor, fromFact, guardUnique, liveStatus, page, toFact } from './rows'

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
      await db.insert(facts).values(fromFact(fact)).onConflictDoNothing()
      return findLive(fact.kind, fact.subjectId, fact.contentKey)
    },

    async transition({ id, from, to, at, review, supersede }) {
      const update = db
        .update(facts)
        .set({ status: to, updatedAt: at, ...(review ? { review: JSON.stringify(review) } : {}) })
        .where(and(eq(facts.id, id), inArray(facts.status, [...from])))
        .returning({ id: facts.id })
      if (!supersede) return guardUnique('facts', SLOT_TAKEN, async () => (await update).length > 0)

      // One batch, original first: it leaves `published` only while this correction is still
      // pending, so the correction can enter `published` without two published facts at once.
      const correction = alias(facts, 'correction')
      const retire = db
        .update(facts)
        .set({ status: 'superseded', updatedAt: at })
        .where(
          and(
            eq(facts.id, supersede),
            eq(facts.status, 'published'),
            exists(
              db
                .select({ one: sql`1` })
                .from(correction)
                .where(
                  and(
                    eq(correction.id, id),
                    inArray(correction.status, [...from]),
                    eq(correction.supersedesId, supersede),
                  ),
                ),
            ),
          ),
        )
      const [, applied] = await guardUnique('facts', SLOT_TAKEN, () => db.batch([retire, update]))
      return applied.length > 0
    },

    async listPendingUpdatedBefore(cutoff, limit) {
      const rows = await db
        .select({ id: facts.id })
        .from(facts)
        .where(and(eq(facts.status, 'pending'), lt(facts.updatedAt, cutoff)))
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
