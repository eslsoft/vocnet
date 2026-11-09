import { createRoute } from '@hono/zod-openapi'
import {
  createEntry,
  createSense,
  getManagedEntry,
  getStats,
  importCoreEntries,
  listEntrySummaries,
  locateNode,
} from '@server/usecases/catalog'
import { listReferenceSources } from '@server/usecases/reference'
import {
  coreImportInputSchema,
  coreImportResultSchema,
  createEntryInputSchema,
  createEntryResultSchema,
  createSenseInputSchema,
  createSenseResultSchema,
  entrySummaryPageSchema,
  lemmaInputSchema,
  managedEntryDetailSchema,
  nodeLocationSchema,
  statsSchema,
} from '@shared/catalog'
import { referenceSourceListSchema } from '@shared/reference'
import { z } from 'zod'
import { actorOf, requireAdmin } from '../auth'
import { createRouter, errorResponse, json, jsonBody, pageQuery } from '../router'
import { entryDto, factDto, managedEntryDto, senseDto } from '../serialize'

const tags = ['Catalog']

const postEntry = createRoute({
  method: 'post',
  path: '/entries',
  tags,
  summary: 'Ensure an entry exists and its entry fact is submitted',
  description: 'Idempotent by lemma: 201 when the entry was created, 200 when it already existed.',
  request: { body: jsonBody(createEntryInputSchema) },
  responses: {
    200: json(createEntryResultSchema, 'The existing entry.'),
    201: json(createEntryResultSchema, 'The created entry.'),
    400: errorResponse,
  },
})

const importCore = createRoute({
  method: 'post',
  path: '/entries/core',
  tags,
  middleware: requireAdmin,
  summary: 'Create entries for the CEFR headwords that have none (admins)',
  description:
    'Creates up to `limit` seed entries for headwords of the imported CEFR profiles that no entry has, lowest ' +
    'level first, each with its entry fact submitted for review. Single letters other than "a" and "I" are ' +
    'skipped. Repeat until `remaining` is 0; a repeat after that creates nothing.',
  request: { body: jsonBody(coreImportInputSchema) },
  responses: {
    200: json(coreImportResultSchema, 'What this call created and what is left.'),
    400: errorResponse,
    403: errorResponse,
  },
})

const postSense = createRoute({
  method: 'post',
  path: '/senses',
  tags,
  summary: 'Create a sense with its gloss fact',
  description: 'Idempotent by (entry, POS, gloss). The gloss is reviewed as a `sense` fact.',
  request: { body: jsonBody(createSenseInputSchema) },
  responses: {
    200: json(createSenseResultSchema, 'The existing sense.'),
    201: json(createSenseResultSchema, 'The created sense.'),
    400: errorResponse,
    422: errorResponse,
  },
})

const listEntries = createRoute({
  method: 'get',
  path: '/entries',
  tags,
  summary: 'List entries in every status, in lemma order',
  description:
    'Each entry comes with its entry status, live sense count, fact counts by status, and last completed work.',
  request: { query: pageQuery.extend({ prefix: lemmaInputSchema.optional() }) },
  responses: { 200: json(entrySummaryPageSchema, 'A page of entry summaries.'), 400: errorResponse },
})

const getEntry = createRoute({
  method: 'get',
  path: '/entries/{lemma}',
  tags,
  summary: 'Get an entry with every fact in every status',
  request: { params: z.object({ lemma: lemmaInputSchema }) },
  responses: { 200: json(managedEntryDetailSchema, 'The entry with its reference data.'), 404: errorResponse },
})

const getNode = createRoute({
  method: 'get',
  path: '/nodes/{id}',
  tags,
  summary: 'Find the entry that owns an entry or sense id',
  description: 'Resolves a fact subject or feedback target to its entry, so a caller can open the entry by lemma.',
  request: { params: z.object({ id: z.uuid() }) },
  responses: { 200: json(nodeLocationSchema, 'The owning entry.'), 404: errorResponse },
})

const stats = createRoute({
  method: 'get',
  path: '/stats',
  tags,
  summary: 'Fact counts by kind and status, and unresolved feedback',
  responses: { 200: json(statsSchema, 'Current counts.') },
})

const sources = createRoute({
  method: 'get',
  path: '/sources',
  tags,
  summary: 'List the external datasets behind frequency and CEFR data',
  responses: { 200: json(referenceSourceListSchema, 'Every reference source.') },
})

export const manageCatalogRoutes = createRouter()
  .openapi(postEntry, async (c) => {
    const result = await createEntry(c.get('deps'), actorOf(c), c.req.valid('json'))
    const body = { entry: entryDto(result.entry), fact: factDto(result.fact), created: result.created }
    return result.created ? c.json(body, 201) : c.json(body, 200)
  })
  .openapi(importCore, async (c) =>
    c.json(await importCoreEntries(c.get('deps'), actorOf(c), c.req.valid('json').limit), 200),
  )
  .openapi(postSense, async (c) => {
    const result = await createSense(c.get('deps'), actorOf(c), c.req.valid('json'))
    const body = { sense: senseDto(result.sense), fact: factDto(result.fact), created: result.created }
    return result.created ? c.json(body, 201) : c.json(body, 200)
  })
  .openapi(listEntries, async (c) => {
    const { prefix, limit, cursor } = c.req.valid('query')
    const page = await listEntrySummaries(c.get('deps'), prefix ?? '', { limit, cursor })
    return c.json({ items: page.items, next_cursor: page.nextCursor }, 200)
  })
  .openapi(getEntry, async (c) => {
    const { frequency, cefr, ...view } = await getManagedEntry(c.get('deps'), c.req.valid('param').lemma)
    return c.json({ ...managedEntryDto(view), frequency, cefr }, 200)
  })
  .openapi(getNode, async (c) => c.json(await locateNode(c.get('deps'), c.req.valid('param').id), 200))
  .openapi(stats, async (c) => c.json(await getStats(c.get('deps')), 200))
  .openapi(sources, async (c) => c.json({ items: await listReferenceSources(c.get('deps')) }, 200))
