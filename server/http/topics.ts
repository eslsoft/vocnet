import { createRoute } from '@hono/zod-openapi'
import { getTopicTree, listTopicSenses } from '@server/usecases/topics'
import { listLangQuerySchema } from '@shared/catalog'
import { topicIdSchema } from '@shared/facts'
import { topicSensePageSchema, topicTreeSchema } from '@shared/topics'
import { z } from 'zod'
import { LIST_CACHE } from './caching'
import { readVariant } from './language'
import { createRouter, errorResponse, json, pageQuery } from './router'

const tags = ['Topics']

const getTopics = createRoute({
  method: 'get',
  path: '/topics',
  tags,
  summary: 'List the topic taxonomy',
  description: 'Every category with its leaf topics, in display order. Only leaf topics tag senses.',
  responses: { 200: json(topicTreeSchema, 'The taxonomy.') },
})

const getTopicSenses = createRoute({
  method: 'get',
  path: '/topics/{id}/senses',
  tags,
  summary: 'List the published senses tagged with a topic',
  description:
    'A leaf topic lists the senses tagged with it; a category lists the senses tagged with any of its topics, each once, as sense summaries. A sense appears when its topic fact, its gloss, and its entry are published. An unknown id is 404. Translations are in the language of ?lang=, else of Accept-Language.',
  request: { params: z.object({ id: topicIdSchema }), query: pageQuery.extend({ lang: listLangQuerySchema }) },
  responses: { 200: json(topicSensePageSchema, 'A page of senses.'), 400: errorResponse, 404: errorResponse },
})

export const topicRoutes = createRouter()
  .openapi(getTopics, async (c) => c.json(await getTopicTree(c.get('deps')), 200))
  .openapi(getTopicSenses, async (c) => {
    const { limit, cursor, lang } = c.req.valid('query')
    const variant = readVariant(c, { lang })
    const page = await listTopicSenses(c.get('deps'), c.req.valid('param').id, { limit, cursor }, variant)
    c.header('Cache-Control', LIST_CACHE)
    return c.json({ lang: variant.lang, items: page.items, next_cursor: page.nextCursor }, 200)
  })
