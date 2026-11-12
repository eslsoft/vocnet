import { createRoute } from '@hono/zod-openapi'
import { getTicketWithEntry, listTickets, resolveTicket, settleSlot } from '@server/usecases/tickets'
import { entryIdSchema } from '@shared/facts'
import {
  listedTicketSchema,
  resolveTicketInputSchema,
  ticketIdSchema,
  ticketPageSchema,
  ticketSchema,
  ticketStatusSchema,
  ticketTypeSchema,
} from '@shared/tickets'
import { settleSlotInputSchema } from '@shared/work'
import { z } from 'zod'
import { actorOf } from '../auth'
import { createRouter, errorResponse, json, jsonBody, pageQuery } from '../router'
import { listedTicketDto, pageDto, ticketDto } from '../serialize'

const tags = ['Tickets']
const idParams = z.object({ id: ticketIdSchema })

const listRoute = createRoute({
  method: 'get',
  path: '/tickets',
  tags,
  summary: 'List tickets, oldest first (curators)',
  description: 'The manual exit: stuck work, reader feedback, audits, and missing words. Each carries its entry.',
  request: {
    query: pageQuery.extend({ status: ticketStatusSchema.optional(), type: ticketTypeSchema.optional() }),
  },
  responses: { 200: json(ticketPageSchema, 'A page of tickets.'), 400: errorResponse, 403: errorResponse },
})

const getRoute = createRoute({
  method: 'get',
  path: '/tickets/{id}',
  tags,
  summary: 'Get one ticket with the entry its target is or belongs to (curators)',
  request: { params: idParams },
  responses: { 200: json(listedTicketSchema, 'The ticket.'), 403: errorResponse, 404: errorResponse },
})

const resolveRoute = createRoute({
  method: 'post',
  path: '/tickets/{id}/resolve',
  tags,
  summary: 'Resolve (with the fixing fact ids) or dismiss an open ticket',
  description: 'Curators only.',
  request: { params: idParams, body: jsonBody(resolveTicketInputSchema) },
  responses: {
    200: json(ticketSchema, 'The closed ticket.'),
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
})

const settleRoute = createRoute({
  method: 'post',
  path: '/entries/{id}/passes',
  tags,
  summary: 'Settle a slot of the entry that nothing can fill',
  description: 'Curators only. The slot counts as filled from now on, so its work item closes.',
  request: { params: z.object({ id: entryIdSchema }), body: jsonBody(settleSlotInputSchema) },
  responses: { 204: { description: 'The slot is settled.' }, 403: errorResponse, 404: errorResponse },
})

export const manageTicketRoutes = createRouter()
  .openapi(listRoute, async (c) => {
    const { status, type, limit, cursor } = c.req.valid('query')
    return c.json(
      pageDto(await listTickets(c.get('deps'), actorOf(c), { status, type }, { limit, cursor }), listedTicketDto),
      200,
    )
  })
  .openapi(getRoute, async (c) =>
    c.json(listedTicketDto(await getTicketWithEntry(c.get('deps'), actorOf(c), c.req.valid('param').id)), 200),
  )
  .openapi(resolveRoute, async (c) => {
    const ticket = await resolveTicket(c.get('deps'), actorOf(c), c.req.valid('param').id, c.req.valid('json'))
    return c.json(ticketDto(ticket), 200)
  })
  .openapi(settleRoute, async (c) => {
    const { type, subject_id, note } = c.req.valid('json')
    await settleSlot(c.get('deps'), actorOf(c), { entryId: c.req.valid('param').id, type, subjectId: subject_id, note })
    return c.body(null, 204)
  })
