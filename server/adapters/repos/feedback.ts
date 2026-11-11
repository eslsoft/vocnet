import { entries, type FeedbackRow, facts, feedback, senses } from '@server/db/schema'
import type { FeedbackRecord } from '@server/domain/feedback'
import type { Lemma } from '@server/domain/term'
import type { FeedbackRepo, WithEntry } from '@server/usecases/ports'
import type { EntryId } from '@shared/facts'
import { feedbackStatusSchema } from '@shared/feedback'
import { and, count, desc, eq, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { type Db, decodeCursor, fromFeedback, page, toFeedback } from './rows'
import { touchWorkOfFact } from './work'

const feedbackCursor = z.object({ created_at: z.string(), id: z.string() })

/**
 * Feedback joined to the entry its target is or belongs to: a fact target through its subject,
 * a sense (the target or the fact's subject) through its entry.
 */
function withEntry(db: Db) {
  return db
    .select({ item: feedback, entryId: entries.id, lemma: entries.lemma })
    .from(feedback)
    .leftJoin(facts, and(eq(feedback.targetType, 'fact'), eq(facts.id, feedback.targetId)))
    .leftJoin(senses, eq(senses.id, sql`coalesce(${facts.subjectId}, ${feedback.targetId})`))
    .innerJoin(entries, eq(entries.id, sql`coalesce(${senses.entryId}, ${facts.subjectId}, ${feedback.targetId})`))
}

const toFeedbackWithEntry = (row: {
  item: FeedbackRow
  entryId: string
  lemma: string
}): WithEntry<FeedbackRecord> => ({
  ...toFeedback(row.item),
  entry: { id: row.entryId as EntryId, lemma: row.lemma as Lemma },
})

export function createFeedbackRepo(db: Db): FeedbackRepo {
  return {
    async insert(item) {
      await db.batch([db.insert(feedback).values(fromFeedback(item)), touchWorkOfFact(db, item.targetId)])
    },

    async find(id) {
      const row = await db.select().from(feedback).where(eq(feedback.id, id)).get()
      return row ? toFeedback(row) : null
    },

    async findWithEntry(id) {
      const row = await withEntry(db).where(eq(feedback.id, id)).get()
      return row ? toFeedbackWithEntry(row) : null
    },

    async update(next, expectedRevision) {
      const [rows] = await db.batch([
        db
          .update(feedback)
          .set(fromFeedback(next))
          .where(and(eq(feedback.id, next.id), eq(feedback.revision, expectedRevision)))
          .returning({ id: feedback.id }),
        touchWorkOfFact(db, next.targetId),
      ])
      return rows.length > 0
    },

    async list({ status }, { limit, cursor }) {
      const after = cursor ? decodeCursor(cursor, feedbackCursor) : undefined
      const rows = await withEntry(db)
        .where(
          and(
            status ? eq(feedback.status, status) : undefined,
            after
              ? or(
                  lt(feedback.createdAt, after.created_at),
                  and(eq(feedback.createdAt, after.created_at), lt(feedback.id, after.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(feedback.createdAt), desc(feedback.id))
        .limit(limit + 1)
      return page(rows, limit, toFeedbackWithEntry, (row) => ({ created_at: row.item.createdAt, id: row.item.id }))
    },

    async countByStatus() {
      const rows = await db.select({ status: feedback.status, count: count() }).from(feedback).groupBy(feedback.status)
      const counts = { open: 0, claimed: 0, resolved: 0, dismissed: 0 }
      for (const row of rows) counts[feedbackStatusSchema.parse(row.status)] = row.count
      return counts
    },
  }
}
