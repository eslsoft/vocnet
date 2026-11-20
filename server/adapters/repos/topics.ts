import { type TopicRow, topics } from '@server/db/schema'
import type { TopicNode } from '@server/domain/topics'
import type { TopicRepo } from '@server/usecases/ports'
import type { TopicId } from '@shared/facts'
import type { MediaId } from '@shared/media'
import { asc, eq } from 'drizzle-orm'
import type { Db } from './rows'

const toTopic = (row: TopicRow): TopicNode => ({
  id: row.id as TopicId,
  parentId: row.parentId as TopicId | null,
  nameEn: row.nameEn,
  nameZh: row.nameZh,
  position: row.position,
  imageId: row.imageId as MediaId | null,
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

    async setImage(id, imageId) {
      await db.update(topics).set({ imageId }).where(eq(topics.id, id))
    },
  }
}
