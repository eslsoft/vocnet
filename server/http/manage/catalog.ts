import { createRoute } from '@hono/zod-openapi'
import { createEntry, createSense, getManagedEntry, getStats, locateNode } from '@server/usecases/catalog'
import {
  createEntryInputSchema,
  createEntryResultSchema,
  createSenseInputSchema,
  createSenseResultSchema,
  lemmaInputSchema,
  managedEntrySchema,
  nodeLocationSchema,
  statsSchema,
} from '@shared/catalog'
import { z } from 'zod'
import { actorOf } from '../auth'
import { createRouter, errorResponse, json, jsonBody } from '../router'
import { entryDto, factDto, senseDto } from '../serialize'

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

const getEntry = createRoute({
  method: 'get',
  path: '/entries/{lemma}',
  tags,
  summary: 'Get an entry with every fact in every status',
  request: { params: z.object({ lemma: lemmaInputSchema }) },
  responses: { 200: json(managedEntrySchema, 'The entry.'), 404: errorResponse },
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

export const manageCatalogRoutes = createRouter()
  .openapi(postEntry, async (c) => {
    const result = await createEntry(c.get('deps'), actorOf(c), c.req.valid('json'))
    const body = { entry: entryDto(result.entry), fact: factDto(result.fact), created: result.created }
    return result.created ? c.json(body, 201) : c.json(body, 200)
  })
  .openapi(postSense, async (c) => {
    const result = await createSense(c.get('deps'), actorOf(c), c.req.valid('json'))
    const body = { sense: senseDto(result.sense), fact: factDto(result.fact), created: result.created }
    return result.created ? c.json(body, 201) : c.json(body, 200)
  })
  .openapi(getEntry, async (c) => {
    const view = await getManagedEntry(c.get('deps'), c.req.valid('param').lemma)
    return c.json(
      { entry: entryDto(view.entry), senses: view.senses.map(senseDto), facts: view.facts.map(factDto) },
      200,
    )
  })
  .openapi(getNode, async (c) => c.json(await locateNode(c.get('deps'), c.req.valid('param').id), 200))
  .openapi(stats, async (c) => c.json(await getStats(c.get('deps')), 200))
