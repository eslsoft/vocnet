import { createRoute } from '@hono/zod-openapi'
import { getPublicEntry, getPublicSense, lookupForm, searchEntries } from '@server/usecases/catalog'
import { submitFeedback } from '@server/usecases/feedback'
import {
  entryPageSchema,
  formLookupSchema,
  lemmaInputSchema,
  publicEntrySchema,
  publicSenseWithEntrySchema,
} from '@shared/catalog'
import { senseIdSchema } from '@shared/facts'
import { feedbackReceiptSchema, submitFeedbackInputSchema } from '@shared/feedback'
import { z } from 'zod'
import { createRouter, errorResponse, json, jsonBody, pageQuery } from './router'

const tags = ['Dictionary']

const listEntries = createRoute({
  method: 'get',
  path: '/entries',
  tags,
  summary: 'List published entries in lemma order',
  request: { query: pageQuery.extend({ prefix: lemmaInputSchema.optional() }) },
  responses: { 200: json(entryPageSchema, 'A page of entries.'), 400: errorResponse },
})

const getEntry = createRoute({
  method: 'get',
  path: '/entries/{lemma}',
  tags,
  summary: 'Get an entry by its exact lemma',
  description: 'Only published facts appear, and a relation appears only when both of its senses are published.',
  request: { params: z.object({ lemma: lemmaInputSchema }) },
  responses: { 200: json(publicEntrySchema, 'The entry.'), 404: errorResponse },
})

const getForm = createRoute({
  method: 'get',
  path: '/forms/{form}',
  tags,
  summary: 'Find the entries an inflected or variant form belongs to',
  description: 'Exact match on published form facts. A form no entry claims is 404; there is no fuzzy fallback.',
  request: { params: z.object({ form: lemmaInputSchema }) },
  responses: { 200: json(formLookupSchema, 'Entries with this form.'), 404: errorResponse },
})

const getSense = createRoute({
  method: 'get',
  path: '/senses/{id}',
  tags,
  summary: 'Get one sense with its entry',
  request: { params: z.object({ id: senseIdSchema }) },
  responses: { 200: json(publicSenseWithEntrySchema, 'The sense.'), 400: errorResponse, 404: errorResponse },
})

const postFeedback = createRoute({
  method: 'post',
  path: '/feedback',
  tags: ['Feedback'],
  summary: 'Report a problem with an entry, a sense, or a fact',
  request: { body: jsonBody(submitFeedbackInputSchema) },
  responses: { 201: json(feedbackReceiptSchema, 'Feedback recorded.'), 400: errorResponse, 422: errorResponse },
})

export const publicRoutes = createRouter()
  .openapi(listEntries, async (c) => {
    const { prefix, limit, cursor } = c.req.valid('query')
    const page = await searchEntries(c.get('deps'), prefix ?? '', { limit, cursor })
    return c.json({ items: page.items, next_cursor: page.nextCursor }, 200)
  })
  .openapi(getEntry, async (c) => c.json(await getPublicEntry(c.get('deps'), c.req.valid('param').lemma), 200))
  .openapi(getForm, async (c) => c.json({ items: await lookupForm(c.get('deps'), c.req.valid('param').form) }, 200))
  .openapi(getSense, async (c) => c.json(await getPublicSense(c.get('deps'), c.req.valid('param').id), 200))
  .openapi(postFeedback, async (c) => {
    const item = await submitFeedback(c.get('deps'), c.req.valid('json'))
    return c.json({ id: item.id, status: item.status }, 201)
  })
