import { createRoute } from '@hono/zod-openapi'
import { curateFact } from '@server/usecases/curation'
import { getFactWithEntry, listFacts, rereviewFact, retractFact, submitFact } from '@server/usecases/facts'
import { lemmaInputSchema } from '@shared/catalog'
import {
  curateFactInputSchema,
  factIdSchema,
  factKindSchema,
  factPageSchema,
  factSchema,
  factStatusSchema,
  factWriteResultSchema,
  listedFactSchema,
  submitFactInputSchema,
} from '@shared/facts'
import { cefrLevelSchema } from '@shared/reference'
import { z } from 'zod'
import { actorOf, requireAdmin } from '../auth'
import { createRouter, errorResponse, json, jsonBody, pageQuery } from '../router'
import { factDto, listedFactDto, pageDto } from '../serialize'

const tags = ['Facts']
const idParams = z.object({ id: factIdSchema })

const postFact = createRoute({
  method: 'post',
  path: '/facts',
  tags,
  summary: 'Submit one fact for review',
  description:
    'Idempotent by content key: resubmitting a live fact returns it with 200. A correction names the published fact it supersedes. ' +
    'A curator may add `curation` to publish the fact at once with a curator review instead of sending it to the reviewer chain (403 forbidden for anyone else). ' +
    'Only a curator may supersede a curated fact or resubmit content a curator rejected (403 curated_fact). ' +
    'Content a review already rejected about the same subject is 409 rejected_before: change the claim instead. ' +
    'Once an entry has a published sense inventory only a curator may submit another (403 inventory_settled).',
  request: { body: jsonBody(submitFactInputSchema) },
  responses: {
    200: json(factWriteResultSchema, 'The existing live fact.'),
    201: json(factWriteResultSchema, 'The fact, pending review, or published when curated.'),
    400: errorResponse,
    403: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
})

const listRoute = createRoute({
  method: 'get',
  path: '/facts',
  tags,
  summary: 'List facts, newest first',
  description: 'Each fact carries the entry its subject is or belongs to.',
  request: {
    query: pageQuery.extend({
      status: factStatusSchema.optional(),
      kind: factKindSchema.optional(),
      level: cefrLevelSchema.optional().meta({
        description: "Only facts about an entry, or a sense of an entry, whose lemma's lowest CEFR level is this.",
      }),
      author: z
        .string()
        .min(1)
        .optional()
        .meta({ description: 'Only facts this principal authored (agent:… or oidc:…).' }),
      lemma: lemmaInputSchema.optional().meta({
        description:
          'Only facts about the entry with exactly this lemma or one of its senses; no other spelling matches.',
      }),
    }),
  },
  responses: { 200: json(factPageSchema, 'A page of facts.'), 400: errorResponse },
})

const getRoute = createRoute({
  method: 'get',
  path: '/facts/{id}',
  tags,
  summary: 'Get one fact with its review and the entry its subject is or belongs to',
  request: { params: idParams },
  responses: { 200: json(listedFactSchema, 'The fact.'), 404: errorResponse },
})

const retractRoute = createRoute({
  method: 'post',
  path: '/facts/{id}/retract',
  tags,
  summary: 'Retract a pending or published fact',
  description:
    'Agents retract only facts they authored, and only curators retract curated ones (403 curated_fact). Retracting twice returns the retracted fact.',
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

const curateRoute = createRoute({
  method: 'post',
  path: '/facts/{id}/curate',
  tags,
  summary: 'Settle a fact by hand (curators)',
  description:
    'pass publishes a pending, published, or rejected fact with a curator review (confidence 1, credibility 1); fail rejects a pending or published one. ' +
    'No reviewer is asked. ' +
    'Passing a rejected fact conflicts (409) when another live fact holds its content or slot, a live correction supersedes it, or the original it corrects is no longer published.',
  request: { params: idParams, body: jsonBody(curateFactInputSchema) },
  responses: {
    200: json(factSchema, 'The settled fact.'),
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
})

export const manageFactRoutes = createRouter()
  .openapi(postFact, async (c) => {
    const { fact, created } = await submitFact(c.get('deps'), actorOf(c), c.req.valid('json'))
    const body = { fact: factDto(fact), created }
    return created ? c.json(body, 201) : c.json(body, 200)
  })
  .openapi(listRoute, async (c) => {
    const { status, kind, author, lemma, level, limit, cursor } = c.req.valid('query')
    const filter = { status, kind, author, lemma, level }
    return c.json(pageDto(await listFacts(c.get('deps'), filter, { limit, cursor }), listedFactDto), 200)
  })
  .openapi(getRoute, async (c) =>
    c.json(listedFactDto(await getFactWithEntry(c.get('deps'), c.req.valid('param').id)), 200),
  )
  .openapi(retractRoute, async (c) =>
    c.json(factDto(await retractFact(c.get('deps'), actorOf(c), c.req.valid('param').id)), 200),
  )
  .openapi(rereviewRoute, async (c) =>
    c.json(factDto(await rereviewFact(c.get('deps'), actorOf(c), c.req.valid('param').id)), 200),
  )
  .openapi(curateRoute, async (c) =>
    c.json(factDto(await curateFact(c.get('deps'), actorOf(c), c.req.valid('param').id, c.req.valid('json'))), 200),
  )
