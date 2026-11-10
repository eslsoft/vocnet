import { createRoute } from '@hono/zod-openapi'
import {
  getPublicEntry,
  getPublicSense,
  listPublicEntries,
  lookupForm,
  searchPublicEntries,
} from '@server/usecases/catalog'
import { submitFeedback } from '@server/usecases/feedback'
import { listReferenceSources } from '@server/usecases/reference'
import {
  entryPageSchema,
  entrySortSchema,
  formLookupSchema,
  includeQuerySchema,
  langQuerySchema,
  lemmaInputSchema,
  levelFilterSchema,
  listLangQuerySchema,
  publicEntrySchema,
  publicSenseDetailSchema,
  searchPageSchema,
  searchQueryTextSchema,
} from '@shared/catalog'
import { posSchema, senseIdSchema, topicIdSchema } from '@shared/facts'
import { feedbackReceiptSchema, submitFeedbackInputSchema } from '@shared/feedback'
import { referenceSourceListSchema } from '@shared/reference'
import { z } from 'zod'
import { etagOf, LIST_CACHE, notModified } from './caching'
import { readVariant } from './language'
import { createRouter, errorResponse, json, jsonBody, notModifiedResponse, pageQuery } from './router'

const tags = ['Dictionary']

const documentQuery = z.object({ lang: langQuerySchema, include: includeQuerySchema })
const LANGUAGE =
  ' Translations and topic names are in the language of ?lang=, else of Accept-Language; the response says which in lang.'

const listEntries = createRoute({
  method: 'get',
  path: '/entries',
  tags,
  summary: 'List published entries, filtered and sorted',
  description:
    'Each entry as a summary, in lemma order or by frequency. level and pos keep the entries with a meaning of that part of speech at one of those levels; with topic, a sense tagged with that topic (a leaf, or any leaf of a category) must also have that part of speech and level. An unknown topic is 404.' +
    LANGUAGE,
  request: {
    query: pageQuery.extend({
      prefix: lemmaInputSchema.optional(),
      level: levelFilterSchema,
      pos: posSchema.optional(),
      topic: topicIdSchema.optional(),
      sort: entrySortSchema,
      lang: listLangQuerySchema,
    }),
  },
  responses: { 200: json(entryPageSchema, 'A page of entries.'), 400: errorResponse, 404: errorResponse },
})

const search = createRoute({
  method: 'get',
  path: '/search',
  tags,
  summary: 'Search headwords, glosses, examples, and translations',
  description:
    'Ranks the exact lemma first, then lemmas that start with q, then entries with a gloss, then a translation in the response language, then an example that holds every word of q (Chinese is matched by its character pairs, so 银行 finds every translation holding 银行). Each entry appears once, at its best rank, then by frequency, then by lemma, with what matched. There is no typo correction or stemming.' +
    LANGUAGE,
  request: { query: pageQuery.extend({ q: searchQueryTextSchema, lang: listLangQuerySchema }) },
  responses: { 200: json(searchPageSchema, 'A page of matching entries.'), 400: errorResponse },
})

const getEntry = createRoute({
  method: 'get',
  path: '/entries/{lemma}',
  tags,
  summary: 'Get an entry by its exact lemma',
  description:
    'Only published facts appear, and a relation appears only when both of its senses are published. ' +
    `Senses are grouped into meanings, one per part of speech.${LANGUAGE} ` +
    'Served from the prebuilt public view with an ETag; send it as If-None-Match to get 304 while the entry is unchanged.',
  request: { params: z.object({ lemma: lemmaInputSchema }), query: documentQuery },
  responses: {
    200: json(publicEntrySchema, 'The entry.'),
    304: notModifiedResponse,
    400: errorResponse,
    404: errorResponse,
  },
})

const getForm = createRoute({
  method: 'get',
  path: '/forms/{form}',
  tags,
  summary: 'Find the entries an inflected or variant form belongs to',
  description: `Exact match on published form facts: each entry with the form as a summary with the forms that matched. A form no entry claims is 404; there is no fuzzy fallback.${LANGUAGE}`,
  request: { params: z.object({ form: lemmaInputSchema }), query: z.object({ lang: listLangQuerySchema }) },
  responses: {
    200: json(formLookupSchema, 'Entries with this form.'),
    304: notModifiedResponse,
    400: errorResponse,
    404: errorResponse,
  },
})

const getSense = createRoute({
  method: 'get',
  path: '/senses/{id}',
  tags,
  summary: 'Get one sense with its entry',
  description: `The sense as the entry document shows it, with its part of speech and its entry as a summary.${LANGUAGE}`,
  request: { params: z.object({ id: senseIdSchema }), query: documentQuery },
  responses: {
    200: json(publicSenseDetailSchema, 'The sense.'),
    304: notModifiedResponse,
    400: errorResponse,
    404: errorResponse,
  },
})

const listSources = createRoute({
  method: 'get',
  path: '/sources',
  tags,
  summary: 'List the external datasets behind frequency and CEFR data',
  description:
    'Each source with its version, license, the changes Vocnet made to its data, and the attribution to show with it. Entries name their source by id.',
  responses: { 200: json(referenceSourceListSchema, 'Every reference source.') },
})

const postFeedback = createRoute({
  method: 'post',
  path: '/feedback',
  tags: ['Feedback'],
  summary: 'Report a problem with an entry, a sense, or a fact',
  description: 'The target must be publicly visible. Each client address may report 10 times a minute.',
  request: { body: jsonBody(submitFeedbackInputSchema) },
  responses: {
    201: json(feedbackReceiptSchema, 'Feedback recorded.'),
    400: errorResponse,
    404: errorResponse,
    429: errorResponse,
  },
})

export const publicRoutes = createRouter()
  .openapi(listEntries, async (c) => {
    const { prefix, level, pos, topic, sort, limit, cursor, lang } = c.req.valid('query')
    const variant = readVariant(c, { lang })
    const filter = { prefix: prefix ?? '', levels: level ?? [], pos: pos ?? null, topic: topic ?? null }
    const page = await listPublicEntries(c.get('deps'), filter, sort, { limit, cursor }, variant)
    c.header('Cache-Control', LIST_CACHE)
    return c.json({ lang: variant.lang, items: page.items, next_cursor: page.nextCursor }, 200)
  })
  .openapi(search, async (c) => {
    const { q, limit, cursor, lang } = c.req.valid('query')
    const variant = readVariant(c, { lang })
    const page = await searchPublicEntries(c.get('deps'), q, { limit, cursor }, variant)
    c.header('Cache-Control', LIST_CACHE)
    return c.json({ lang: variant.lang, items: page.items, next_cursor: page.nextCursor }, 200)
  })
  .openapi(getEntry, async (c) => {
    const variant = readVariant(c, c.req.valid('query'))
    const entry = await getPublicEntry(c.get('deps'), c.req.valid('param').lemma, variant)
    return notModified(c, await etagOf(entry.versions, variant)) ?? c.json(entry.read(), 200)
  })
  .openapi(getForm, async (c) => {
    const variant = readVariant(c, c.req.valid('query'))
    const found = await lookupForm(c.get('deps'), c.req.valid('param').form, variant)
    return (
      notModified(c, await etagOf(found.versions, variant)) ?? c.json({ lang: variant.lang, items: found.read() }, 200)
    )
  })
  .openapi(getSense, async (c) => {
    const variant = readVariant(c, c.req.valid('query'))
    const sense = await getPublicSense(c.get('deps'), c.req.valid('param').id, variant)
    return notModified(c, await etagOf(sense.versions, variant)) ?? c.json(sense.read(), 200)
  })
  .openapi(listSources, async (c) => c.json({ items: await listReferenceSources(c.get('deps')) }, 200))
  .openapi(postFeedback, async (c) => {
    const client = c.req.header('cf-connecting-ip')
    if (!client) throw new Error('CF-Connecting-IP is missing; the Worker must run behind Cloudflare.')
    const item = await submitFeedback(c.get('deps'), client, c.req.valid('json'))
    return c.json({ id: item.id, status: item.status }, 201)
  })
