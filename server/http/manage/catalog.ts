import { createRoute } from '@hono/zod-openapi'
import {
  createEntry,
  getManagedEntry,
  importCoreEntries,
  listEntrySummaries,
  locateNode,
} from '@server/usecases/catalog'
import { getConsoleStats } from '@server/usecases/monitor'
import { listReferenceSources } from '@server/usecases/reference'
import {
  coreImportInputSchema,
  coreImportResultSchema,
  createEntryInputSchema,
  createEntryResultSchema,
  entrySummaryPageSchema,
  lemmaInputSchema,
  managedEntryDetailSchema,
  nodeLocationSchema,
} from '@shared/catalog'
import { consoleStatsSchema } from '@shared/monitor'
import { cefrLevelSchema, referenceSourceListSchema } from '@shared/reference'
import { z } from 'zod'
import { actorOf, requireAdmin } from '../auth'
import { createRouter, errorResponse, json, jsonBody, pageQuery } from '../router'
import { entryDto, managedEntryDto } from '../serialize'

const tags = ['Catalog']

const postEntry = createRoute({
  method: 'post',
  path: '/entries',
  tags,
  summary: 'Admit a lemma as a headword of a batch (curators)',
  description:
    'Idempotent by lemma: 201 when the entry was created, 200 when it already existed; either way it is live ' +
    'from now on, keeping an earlier batch. Agents never create entries.',
  request: { body: jsonBody(createEntryInputSchema) },
  responses: {
    200: json(createEntryResultSchema, 'The existing entry.'),
    201: json(createEntryResultSchema, 'The created entry.'),
    400: errorResponse,
    403: errorResponse,
  },
})

const importCore = createRoute({
  method: 'post',
  path: '/entries/core',
  tags,
  middleware: requireAdmin,
  summary: 'Admit the CEFR headwords that have no entry as batch 1 (admins)',
  description:
    'Admits up to `limit` headwords of the imported CEFR profiles that no entry has, lowest level first. Single ' +
    'letters other than "a" and "I" are skipped. Repeat until `remaining` is 0; a repeat after that admits nothing.',
  request: { body: jsonBody(coreImportInputSchema) },
  responses: {
    200: json(coreImportResultSchema, 'What this call created and what is left.'),
    400: errorResponse,
    403: errorResponse,
  },
})

const listEntries = createRoute({
  method: 'get',
  path: '/entries',
  tags,
  summary: 'List entries in every status, in lemma order',
  description:
    'Each entry comes with whether it is live, its inventory size, fact counts by status, last completed work, lowest ' +
    'CEFR level, its scores and slot counts as of its last rescore, and its open work items by where they stand.',
  request: {
    query: pageQuery.extend({
      prefix: lemmaInputSchema.optional(),
      level: cefrLevelSchema.optional().meta({ description: "Only entries whose lemma's lowest CEFR level is this." }),
      stuck: z
        .enum(['true'])
        .optional()
        .meta({ description: 'Only entries with an item its passes did not fill (a stuck_work ticket).' }),
    }),
  },
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
  description: 'Resolves a fact subject or ticket target to its entry, so a caller can open the entry by lemma.',
  request: { params: z.object({ id: z.uuid() }) },
  responses: { 200: json(nodeLocationSchema, 'The owning entry.'), 404: errorResponse },
})

const stats = createRoute({
  method: 'get',
  path: '/stats',
  tags,
  summary: 'Counts for the console overview',
  description:
    'Facts by kind and status, low-credibility published facts by kind, live facts, average completeness overall ' +
    'and by lowest CEFR level of the live entries (as of their last rescore), the pending reviews and how many ' +
    'have waited over an hour, tickets by status, and the open, stuck, and timed-out (last 24 hours) work.',
  responses: { 200: json(consoleStatsSchema, 'Current counts.') },
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
    const body = { entry: entryDto(result.entry), created: result.created }
    return result.created ? c.json(body, 201) : c.json(body, 200)
  })
  .openapi(importCore, async (c) =>
    c.json(await importCoreEntries(c.get('deps'), actorOf(c), c.req.valid('json').limit), 200),
  )
  .openapi(listEntries, async (c) => {
    const { prefix, level, stuck, limit, cursor } = c.req.valid('query')
    const filter = { prefix: prefix ?? '', level: level ?? null, stuck: stuck === 'true' }
    const page = await listEntrySummaries(c.get('deps'), filter, { limit, cursor })
    return c.json({ items: page.items, next_cursor: page.nextCursor }, 200)
  })
  .openapi(getEntry, async (c) => {
    const { frequency, cefr, ...view } = await getManagedEntry(c.get('deps'), c.req.valid('param').lemma)
    return c.json({ ...managedEntryDto(view), frequency, cefr }, 200)
  })
  .openapi(getNode, async (c) => c.json(await locateNode(c.get('deps'), c.req.valid('param').id), 200))
  .openapi(stats, async (c) => c.json(await getConsoleStats(c.get('deps')), 200))
  .openapi(sources, async (c) => c.json({ items: await listReferenceSources(c.get('deps')) }, 200))
