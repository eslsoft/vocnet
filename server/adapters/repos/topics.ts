import { entries, facts, senses, type TopicRow, topics } from '@server/db/schema'
import type { Lemma } from '@server/domain/term'
import type { TopicNode } from '@server/domain/topics'
import type { TopicRepo } from '@server/usecases/ports'
import { factPayloadSchemas, posSchema, type SenseId, type TopicId } from '@shared/facts'
import { and, asc, eq, exists, gt, inArray, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { type Db, decodeCursor, liveStatus, page } from './rows'

const senseCursor = z.object({ lemma: z.string(), id: z.string() })

const toTopic = (row: TopicRow): TopicNode => ({
  id: row.id as TopicId,
  parentId: row.parentId as TopicId | null,
  nameEn: row.nameEn,
  nameZh: row.nameZh,
  position: row.position,
})

export function createTopicRepo(db: Db): TopicRepo {
  return {
    async list() {
      const rows = await db.select().from(topics).orderBy(asc(topics.position), asc(topics.id))
      return rows.map(toTopic)
    },

    async find(id) {
      const row = await db.select().from(topics).where(eq(topics.id, id)).get()
      return row ? toTopic(row) : null
    },

    async listTaggedSenses(leaves, { limit, cursor }) {
      const after = cursor ? decodeCursor(cursor, senseCursor) : undefined
      const gloss = alias(facts, 'gloss')
      const entryFact = alias(facts, 'entry_fact')
      const publishedEntry = db
        .select({ one: sql`1` })
        .from(entryFact)
        .where(and(eq(entryFact.subjectId, entries.id), eq(entryFact.kind, 'entry'), eq(entryFact.status, 'published')))
      // Driven from the topic facts through facts_live_content_idx (kind, content_key), so the
      // predicate repeats the index's live status; only the tagged senses are sorted. A sense
      // tagged with two leaves of one category appears once.
      const rows = await db
        .selectDistinct({ id: senses.id, lemma: entries.lemma, pos: senses.pos, payload: gloss.payload })
        .from(facts)
        .innerJoin(senses, eq(senses.id, facts.subjectId))
        .innerJoin(entries, eq(entries.id, senses.entryId))
        .innerJoin(gloss, and(eq(gloss.subjectId, senses.id), eq(gloss.kind, 'sense'), eq(gloss.status, 'published')))
        .where(
          and(
            eq(facts.kind, 'topic'),
            inArray(facts.contentKey, [...leaves]),
            liveStatus,
            eq(facts.status, 'published'),
            exists(publishedEntry),
            after
              ? or(gt(entries.lemma, after.lemma), and(eq(entries.lemma, after.lemma), gt(senses.id, after.id)))
              : undefined,
          ),
        )
        .orderBy(asc(entries.lemma), asc(senses.id))
        .limit(limit + 1)
      return page(
        rows,
        limit,
        (row) => ({
          id: row.id as SenseId,
          lemma: row.lemma as Lemma,
          pos: posSchema.parse(row.pos),
          gloss: factPayloadSchemas.sense.parse(JSON.parse(row.payload)).gloss,
        }),
        (row) => ({ lemma: row.lemma, id: row.id }),
      )
    },
  }
}
