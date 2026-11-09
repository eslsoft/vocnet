import { feedback } from '@server/db/schema'
import type { FeedbackRepo } from '@server/usecases/ports'
import { and, count, desc, eq, inArray, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import { type Db, decodeCursor, fromFeedback, page, toFeedback } from './rows'
import { touchWorkOfFact } from './work'

const feedbackCursor = z.object({ created_at: z.string(), id: z.string() })

export function createFeedbackRepo(db: Db): FeedbackRepo {
  return {
    async insert(item) {
      await db.batch([db.insert(feedback).values(fromFeedback(item)), touchWorkOfFact(db, item.targetId)])
    },

    async find(id) {
      const row = await db.select().from(feedback).where(eq(feedback.id, id)).get()
      return row ? toFeedback(row) : null
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
      const rows = await db
        .select()
        .from(feedback)
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
      return page(rows, limit, toFeedback, (row) => ({ created_at: row.createdAt, id: row.id }))
    },

    async countOpen() {
      const [row] = await db
        .select({ count: count() })
        .from(feedback)
        .where(inArray(feedback.status, ['open', 'claimed']))
      return row.count
    },
  }
}
