import { createRoute } from '@hono/zod-openapi'
import {
  getPublicEntry,
  getPublicSense,
  getPublicSentence,
  listEntryOverviews,
  listPublicEntries,
  listSenseMembers,
  lookupForm,
  searchPublicEntries,
} from '@server/usecases/catalog'
import { listReferenceSources } from '@server/usecases/reference'
import { submitFeedback } from '@server/usecases/tickets'
import {
  entryOverviewListSchema,
  entryPageSchema,
  entrySortSchema,
  formLookupSchema,
  includeQuerySchema,
  langQuerySchema,
  lemmaInputSchema,
  levelFilterSchema,
  listLangQuerySchema,
  memberPageSchema,
  overviewLemmasSchema,
  overviewSensesSchema,
  publicEntrySchema,
  publicSenseDetailSchema,
  publicSentenceSchema,
  searchPageSchema,
  searchQueryTextSchema,
} from '@shared/catalog'
import { posSchema, relationDomainSchema, senseIdSchema, sentenceIdSchema, topicIdSchema } from '@shared/facts'
import { referenceSourceListSchema } from '@shared/reference'
import { feedbackReceiptSchema, submitFeedbackInputSchema } from '@shared/tickets'
import { z } from 'zod'
import { etagOf, LIST_CACHE, notModified } from './caching'
import { readVariant } from './language'
import { createRouter, errorResponse, json, jsonBody, notModifiedResponse, pageQuery } from './router'

const tags = ['Dictionary']

const documentQuery = z.object({
  lang: langQuerySchema,
  include: includeQuerySchema,
  domain: relationDomainSchema.optional().meta({
    description:
      'Also show the hypernyms of this specialist taxonomy (biology: dog is a kind of canine) beside the everyday layer, each marked with its domain. Absent shows the everyday layer alone.',
  }),
})
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

const listOverviews = createRoute({
  method: 'get',
  path: '/overviews',
  tags,
  summary: 'Get the overviews of many entries by their exact lemmas',
  description:
    'What a word card shows, for up to 100 lemmas in one read: each entry with its US and UK pronunciations and, per part of speech, its sense count and first senses with every translation in the response language. Items come in the order asked, each once; a lemma with no public entry is named in missing, with no fuzzy fallback.' +
    LANGUAGE,
  request: {
    query: z.object({ lemma: overviewLemmasSchema, senses: overviewSensesSchema, lang: listLangQuerySchema }),
  },
  responses: { 200: json(entryOverviewListSchema, 'The overviews and the lemmas without one.'), 400: errorResponse },
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

const getSentence = createRoute({
  method: 'get',
  path: '/sentences/{id}',
  tags,
  summary: 'Get one sentence: an example or a saying',
  description: `The sentence with its source, its translation, its meaning when it is a saying, and the public senses it is a published example of and the public headwords whose published phrases list names it a saying. A sentence neither is 404.${LANGUAGE}`,
  request: { params: z.object({ id: sentenceIdSchema }), query: z.object({ lang: langQuerySchema }) },
  responses: {
    200: json(publicSentenceSchema, 'The sentence.'),
    304: notModifiedResponse,
    400: errorResponse,
    404: errorResponse,
  },
})

const listMembers = createRoute({
  method: 'get',
  path: '/senses/{id}/members',
  tags,
  summary: 'List the kinds of a sense taken as a category',
  description:
    'Every public sense whose broader terms lead up to this one ("animal": dog, cat, eagle, and each bird through "bird"), each once at its nearest depth, nearest first, then by lemma, so pages go down level by level. Each member names the senses it is a direct kind of within the walk (parents), which rebuilds the tree, and total counts the members over every page. The everyday layer by default; ?domain= also walks that specialist taxonomy (biology: canine, carnivore, mammal). A sense that is not public is 404.' +
    LANGUAGE,
  request: {
    params: z.object({ id: senseIdSchema }),
    query: pageQuery.extend({
      domain: relationDomainSchema.optional().meta({
        description: 'Also walk the hypernyms of this specialist taxonomy; absent walks the everyday layer alone.',
      }),
      lang: listLangQuerySchema,
    }),
  },
  responses: { 200: json(memberPageSchema, 'A page of members.'), 400: errorResponse, 404: errorResponse },
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
  .openapi(listOverviews, async (c) => {
    const { lemma, senses, lang } = c.req.valid('query')
    const variant = readVariant(c, { lang })
    const found = await listEntryOverviews(c.get('deps'), [lemma].flat(), senses, variant)
    c.header('Cache-Control', LIST_CACHE)
    return c.json({ lang: variant.lang, items: found.items, missing: found.missing }, 200)
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
  .openapi(getSentence, async (c) => {
    const variant = readVariant(c, c.req.valid('query'))
    const sentence = await getPublicSentence(c.get('deps'), c.req.valid('param').id, variant)
    return notModified(c, await etagOf(sentence.versions, variant)) ?? c.json(sentence.read(), 200)
  })
  .openapi(listMembers, async (c) => {
    const { domain, limit, cursor, lang } = c.req.valid('query')
    const variant = readVariant(c, { lang })
    const page = await listSenseMembers(
      c.get('deps'),
      c.req.valid('param').id,
      domain ?? null,
      { limit, cursor },
      variant,
    )
    c.header('Cache-Control', LIST_CACHE)
    return c.json({ lang: variant.lang, total: page.total, items: page.items, next_cursor: page.nextCursor }, 200)
  })
  .openapi(listSources, async (c) => c.json({ items: await listReferenceSources(c.get('deps')) }, 200))
  .openapi(postFeedback, async (c) => {
    const client = c.req.header('cf-connecting-ip')
    if (!client) throw new Error('CF-Connecting-IP is missing; the Worker must run behind Cloudflare.')
    const item = await submitFeedback(c.get('deps'), client, c.req.valid('json'))
    return c.json({ id: item.id, status: item.status }, 201)
  })
