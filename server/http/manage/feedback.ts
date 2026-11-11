import { createRoute } from '@hono/zod-openapi'
import { claimFeedback, getFeedbackWithEntry, listFeedback, resolveFeedback } from '@server/usecases/feedback'
import {
  feedbackIdSchema,
  feedbackPageSchema,
  feedbackSchema,
  feedbackStatusSchema,
  listedFeedbackSchema,
  resolveFeedbackInputSchema,
} from '@shared/feedback'
import { z } from 'zod'
import { actorOf } from '../auth'
import { createRouter, errorResponse, json, jsonBody, pageQuery } from '../router'
import { feedbackDto, listedFeedbackDto, pageDto } from '../serialize'

const tags = ['Feedback']
const idParams = z.object({ id: feedbackIdSchema })

const listRoute = createRoute({
  method: 'get',
  path: '/feedback',
  tags,
  summary: 'List feedback, newest first',
  description: 'Each item carries the entry its target is or belongs to.',
  request: { query: pageQuery.extend({ status: feedbackStatusSchema.optional() }) },
  responses: { 200: json(feedbackPageSchema, 'A page of feedback.'), 400: errorResponse },
})

const getRoute = createRoute({
  method: 'get',
  path: '/feedback/{id}',
  tags,
  summary: 'Get one feedback item with the entry its target is or belongs to',
  request: { params: idParams },
  responses: { 200: json(listedFeedbackSchema, 'The feedback.'), 404: errorResponse },
})

const claimRoute = createRoute({
  method: 'post',
  path: '/feedback/{id}/claim',
  tags,
  summary: 'Claim feedback with a one-hour lease',
  description: 'An expired claim can be claimed by anyone; the holder may renew at any time.',
  request: { params: idParams },
  responses: { 200: json(feedbackSchema, 'The claimed feedback.'), 404: errorResponse, 409: errorResponse },
})

const resolveRoute = createRoute({
  method: 'post',
  path: '/feedback/{id}/resolve',
  tags,
  summary: 'Resolve (with the correcting fact ids) or dismiss claimed feedback',
  request: { params: idParams, body: jsonBody(resolveFeedbackInputSchema) },
  responses: {
    200: json(feedbackSchema, 'The closed feedback.'),
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
})

export const manageFeedbackRoutes = createRouter()
  .openapi(listRoute, async (c) => {
    const { status, limit, cursor } = c.req.valid('query')
    return c.json(pageDto(await listFeedback(c.get('deps'), { status }, { limit, cursor }), listedFeedbackDto), 200)
  })
  .openapi(getRoute, async (c) =>
    c.json(listedFeedbackDto(await getFeedbackWithEntry(c.get('deps'), c.req.valid('param').id)), 200),
  )
  .openapi(claimRoute, async (c) =>
    c.json(feedbackDto(await claimFeedback(c.get('deps'), actorOf(c), c.req.valid('param').id)), 200),
  )
  .openapi(resolveRoute, async (c) => {
    const item = await resolveFeedback(c.get('deps'), actorOf(c), c.req.valid('param').id, c.req.valid('json'))
    return c.json(feedbackDto(item), 200)
  })
