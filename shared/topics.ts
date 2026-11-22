import { z } from 'zod'
import { responseLangSchema, senseSummarySchema } from './catalog'
import { topicIdSchema } from './facts'

// The topic taxonomy on the wire. Topics are admin-curated by migration, their pictures by curators:
// categories group the topics, and both tag senses.

const count = z.number().int().nonnegative()

const topicFields = {
  id: topicIdSchema,
  name: z
    .object({ en: z.string(), zh: z.string() })
    .meta({ description: 'The name by language tag, as Sense.topics names a topic.' }),
  image_url: z.string().nullable().meta({
    description:
      'The URL of its picture under the configured media base, cacheable forever; null until a curator sets one.',
  }),
  sense_count: count.meta({
    description:
      'How many public senses GET /v1/topics/{id}/senses lists for it; a category counts each sense tagged with it or any of its topics once.',
  }),
  entry_count: count.meta({
    description:
      'How many public entries GET /v1/entries?topic= lists for it: those with a common (not rare) sense tagged with it.',
  }),
}

export const topicSchema = z
  .object(topicFields)
  .meta({ id: 'Topic', description: 'A topic of a category: the subject a sense means something of.' })

export const topicCategorySchema = z.object({ ...topicFields, topics: z.array(topicSchema) }).meta({
  id: 'TopicCategory',
  description: 'A category of the taxonomy with its topics, in display order; it also tags a sense none of them holds.',
})

export const topicTreeSchema = z.object({ categories: z.array(topicCategorySchema) }).meta({ id: 'TopicTree' })
export type TopicTree = z.infer<typeof topicTreeSchema>

export const topicSenseSchema = senseSummarySchema
  .extend({
    rare: z.boolean().meta({
      description:
        "true: the entry's inventory ranks the sense extra (rare, archaic, or specialist), so GET /v1/entries?topic= does not list its entry for it.",
    }),
    specialized: z.boolean().meta({
      description:
        "true: a specialized sense of a word whose main sense (its inventory's first) belongs to another subject or none, such as first meaning the lowest gear; false: the topic's core vocabulary. A listing gives every core sense first.",
    }),
  })
  .meta({ id: 'TopicSense', description: 'One sense as a topic listing shows it.' })
export type TopicSense = z.infer<typeof topicSenseSchema>

export const topicSensePageSchema = z
  .object({ lang: responseLangSchema, items: z.array(topicSenseSchema), next_cursor: z.string().nullable() })
  .meta({
    id: 'TopicSensePage',
    description:
      'Published senses tagged with a topic, its core vocabulary first, then its specialized senses, each in the order asked.',
  })
