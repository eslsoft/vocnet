import { z } from 'zod'
import { responseLangSchema, senseSummarySchema } from './catalog'
import { topicIdSchema } from './facts'

// The topic taxonomy on the wire. Topics are admin-curated by migration, their pictures by curators:
// categories group the leaf topics, and only leaves tag senses.

const count = z.number().int().nonnegative()

const topicFields = {
  id: topicIdSchema,
  name: z
    .object({ en: z.string(), zh: z.string() })
    .meta({ description: 'The name by language tag, as Sense.topics names a topic.' }),
  image_url: z.string().nullable().meta({
    description: 'The path of its picture under this server, cacheable forever; null until a curator sets one.',
  }),
  sense_count: count.meta({
    description: 'How many public senses GET /v1/topics/{id}/senses lists for it; a category counts each sense once.',
  }),
  entry_count: count.meta({
    description:
      'How many public entries GET /v1/entries?topic= lists for it: those with a common (not rare) sense tagged with it.',
  }),
}

export const topicSchema = z
  .object(topicFields)
  .meta({ id: 'Topic', description: 'A leaf topic a sense can be tagged with.' })

export const topicCategorySchema = z
  .object({ ...topicFields, topics: z.array(topicSchema) })
  .meta({ id: 'TopicCategory', description: 'A category of the taxonomy with its leaf topics, in display order.' })

export const topicTreeSchema = z.object({ categories: z.array(topicCategorySchema) }).meta({ id: 'TopicTree' })
export type TopicTree = z.infer<typeof topicTreeSchema>

export const topicSenseSchema = senseSummarySchema
  .extend({
    rare: z.boolean().meta({
      description:
        "true: the entry's inventory ranks the sense extra (rare, archaic, or specialist), so GET /v1/entries?topic= does not list its entry for it.",
    }),
  })
  .meta({ id: 'TopicSense', description: 'One sense as a topic listing shows it.' })
export type TopicSense = z.infer<typeof topicSenseSchema>

export const topicSensePageSchema = z
  .object({ lang: responseLangSchema, items: z.array(topicSenseSchema), next_cursor: z.string().nullable() })
  .meta({ id: 'TopicSensePage', description: 'Published senses tagged with a topic, in the order asked.' })
