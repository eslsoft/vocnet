import { z } from 'zod'
import { senseRefSchema } from './catalog'
import { topicIdSchema } from './facts'

// The topic taxonomy on the wire. Topics are admin-curated by migration: categories group the
// leaf topics, and only leaves tag senses.

const topicFields = {
  id: topicIdSchema,
  name_en: z.string(),
  name_zh: z.string(),
}

export const topicSchema = z
  .object(topicFields)
  .meta({ id: 'Topic', description: 'A leaf topic a sense can be tagged with.' })

export const topicCategorySchema = z
  .object({ ...topicFields, topics: z.array(topicSchema) })
  .meta({ id: 'TopicCategory', description: 'A category of the taxonomy with its leaf topics, in display order.' })

export const topicTreeSchema = z.object({ categories: z.array(topicCategorySchema) }).meta({ id: 'TopicTree' })
export type TopicTree = z.infer<typeof topicTreeSchema>

export const topicSensePageSchema = z
  .object({ items: z.array(senseRefSchema), next_cursor: z.string().nullable() })
  .meta({ id: 'TopicSensePage', description: 'Published senses tagged with a topic, in lemma order.' })
