import {
  listedTicketSchema,
  type ResolveTicketInput,
  type TicketId,
  type TicketStatus,
  type TicketType,
  ticketPageSchema,
  ticketSchema,
} from '@shared/tickets'
import { decodeApiResponse, rpc } from '@/shared/api/client'

const tickets = rpc.manage.v1.tickets

export interface TicketFilter {
  status?: TicketStatus
  type?: TicketType
}

export async function listTickets(filter: TicketFilter, cursor: string | undefined) {
  const response = await tickets.$get({ query: { ...filter, cursor, limit: '25' } })
  return decodeApiResponse(response, ticketPageSchema)
}

export async function getTicket(id: TicketId) {
  return decodeApiResponse(await tickets[':id'].$get({ param: { id } }), listedTicketSchema)
}

export async function resolveTicket(id: TicketId, input: ResolveTicketInput) {
  return decodeApiResponse(await tickets[':id'].resolve.$post({ param: { id }, json: input }), ticketSchema)
}
