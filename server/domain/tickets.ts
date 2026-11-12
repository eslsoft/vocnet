import type { FactId } from '@shared/facts'
import type { TicketId, TicketStatus, TicketTargetType, TicketType } from '@shared/tickets'

/** One thing a curator handles by hand. */
export interface TicketRecord {
  id: TicketId
  type: TicketType
  targetType: TicketTargetType
  /** The entry, sense, or fact id, or the missing lemma. */
  target: string
  message: string
  status: TicketStatus
  resolutionNote: string | null
  resolutionFactIds: FactId[]
  /** Bumped on every write; writes are compare-and-set on it. */
  revision: number
  createdAt: string
  updatedAt: string
}

export const isClosed = (status: TicketStatus): boolean => status === 'resolved' || status === 'dismissed'

/** A curator closes an open ticket, naming the facts that fixed it or why nothing needed fixing. */
export function resolve(
  ticket: TicketRecord,
  outcome: { status: 'resolved' | 'dismissed'; note: string; factIds: FactId[] },
  now: Date,
): TicketRecord {
  return {
    ...ticket,
    status: outcome.status,
    resolutionNote: outcome.note,
    resolutionFactIds: outcome.factIds,
    revision: ticket.revision + 1,
    updatedAt: now.toISOString(),
  }
}
