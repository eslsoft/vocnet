import { createRoute } from '@hono/zod-openapi'
import { getFact, listFacts, rereviewFact, retractFact, submitFact } from '@server/usecases/facts'
import {
  factIdSchema,
  factKindSchema,
  factPageSchema,
  factSchema,
  factStatusSchema,
  factWriteResultSchema,
  submitFactInputSchema,
} from '@shared/facts'
import { z } from 'zod'
import { actorOf, requireAdmin } from '../auth'
import { createRouter, errorResponse, json, jsonBody, pageQuery } from '../router'
import { factDto, pageDto } from '../serialize'

const tags = ['Facts']
const idParams = z.object({ id: factIdSchema })

const postFact = createRoute({
  method: 'post',
  path: '/facts',
  tags,
  summary: 'Submit one fact for review',
  description:
    'Idempotent by content key: resubmitting a live fact returns it with 200. A correction names the published fact it supersedes.',
  request: { body: jsonBody(submitFactInputSchema) },
  responses: {
    200: json(factWriteResultSchema, 'The existing live fact.'),
    201: json(factWriteResultSchema, 'The fact, pending review.'),
    400: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
})

const listRoute = createRoute({
  method: 'get',
  path: '/facts',
  tags,
  summary: 'List facts, newest first',
  request: { query: pageQuery.extend({ status: factStatusSchema.optional(), kind: factKindSchema.optional() }) },
  responses: { 200: json(factPageSchema, 'A page of facts.'), 400: errorResponse },
})

const getRoute = createRoute({
  method: 'get',
  path: '/facts/{id}',
  tags,
  summary: 'Get one fact with its review',
  request: { params: idParams },
  responses: { 200: json(factSchema, 'The fact.'), 404: errorResponse },
})

const retractRoute = createRoute({
  method: 'post',
  path: '/facts/{id}/retract',
  tags,
  summary: 'Retract a pending or published fact',
  description: 'Agents retract only facts they authored. Retracting twice returns the retracted fact.',
  request: { params: idParams },
  responses: {
    200: json(factSchema, 'The retracted fact.'),
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
})

const rereviewRoute = createRoute({
  method: 'post',
  path: '/facts/{id}/rereview',
  tags,
  summary: 'Send a decided fact back through review (admins)',
  middleware: requireAdmin,
  request: { params: idParams },
  responses: {
    200: json(factSchema, 'The fact, pending again.'),
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
})

export const manageFactRoutes = createRouter()
  .openapi(postFact, async (c) => {
    const { fact, created } = await submitFact(c.get('deps'), actorOf(c), c.req.valid('json'))
    const body = { fact: factDto(fact), created }
    return created ? c.json(body, 201) : c.json(body, 200)
  })
  .openapi(listRoute, async (c) => {
    const { status, kind, limit, cursor } = c.req.valid('query')
    return c.json(pageDto(await listFacts(c.get('deps'), { status, kind }, { limit, cursor }), factDto), 200)
  })
  .openapi(getRoute, async (c) => c.json(factDto(await getFact(c.get('deps'), c.req.valid('param').id)), 200))
  .openapi(retractRoute, async (c) =>
    c.json(factDto(await retractFact(c.get('deps'), actorOf(c), c.req.valid('param').id)), 200),
  )
  .openapi(rereviewRoute, async (c) =>
    c.json(factDto(await rereviewFact(c.get('deps'), actorOf(c), c.req.valid('param').id)), 200),
  )
