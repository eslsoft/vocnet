import { createRoute } from '@hono/zod-openapi'
import { getTopicTree, listTopicSenses } from '@server/usecases/topics'
import { listLangQuerySchema, senseSortSchema } from '@shared/catalog'
import { topicIdSchema } from '@shared/facts'
import { topicSensePageSchema, topicTreeSchema } from '@shared/topics'
import { z } from 'zod'
import { etagOf, LIST_CACHE, notModified } from './caching'
import { readVariant } from './language'
import { createRouter, errorResponse, json, notModifiedResponse, pageQuery } from './router'

const tags = ['Topics']

const getTopics = createRoute({
  method: 'get',
  path: '/topics',
  tags,
  summary: 'List the topic taxonomy',
  description:
    'Every category with its leaf topics, in display order, each with its names and how many public senses and entries it lists. Only leaf topics tag senses. Carries an ETag; send it as If-None-Match to get 304 while the taxonomy and its counts are unchanged.',
  responses: { 200: json(topicTreeSchema, 'The taxonomy.'), 304: notModifiedResponse },
})

const getTopicSenses = createRoute({
  method: 'get',
  path: '/topics/{id}/senses',
  tags,
  summary: 'List the published senses tagged with a topic',
  description:
    'A leaf topic lists the senses tagged with it; a category lists the senses tagged with any of its topics, each once, as sense summaries marked rare when the entry ranks the sense extra, by lemma, frequency, or level. A sense appears when its topic fact, its gloss, and its entry are published. An unknown id is 404. Translations are in the language of ?lang=, else of Accept-Language.',
  request: {
    params: z.object({ id: topicIdSchema }),
    query: pageQuery.extend({ sort: senseSortSchema, lang: listLangQuerySchema }),
  },
  responses: { 200: json(topicSensePageSchema, 'A page of senses.'), 400: errorResponse, 404: errorResponse },
})

export const topicRoutes = createRouter()
  .openapi(getTopics, async (c) => {
    const tree = await getTopicTree(c.get('deps'))
    const etag = await etagOf([JSON.stringify(tree)], { lang: null, review: false })
    return notModified(c, etag, LIST_CACHE) ?? c.json(tree, 200)
  })
  .openapi(getTopicSenses, async (c) => {
    const { sort, limit, cursor, lang } = c.req.valid('query')
    const variant = readVariant(c, { lang })
    const page = await listTopicSenses(c.get('deps'), c.req.valid('param').id, sort, { limit, cursor }, variant)
    c.header('Cache-Control', LIST_CACHE)
    return c.json({ lang: variant.lang, items: page.items, next_cursor: page.nextCursor }, 200)
  })
