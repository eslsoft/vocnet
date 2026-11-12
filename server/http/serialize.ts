import type { ManagedEntryView } from '@server/domain/catalog-view'
import type { Fact } from '@server/domain/fact'
import type { EntryNode, SenseNode } from '@server/domain/nodes'
import type { TicketRecord } from '@server/domain/tickets'
import type { AgentRecord, Page, WithEntry } from '@server/usecases/ports'
import type { AgentDto } from '@shared/agents'
import type { FactDto, ListedFactDto } from '@shared/facts'
import type { ListedTicketDto, TicketDto } from '@shared/tickets'

// Domain records to the snake_case wire DTOs in shared/.

export const entryDto = (entry: EntryNode) => ({
  id: entry.id,
  lemma: entry.lemma,
  created_by: entry.createdBy,
  created_at: entry.createdAt,
})

export const senseDto = (sense: SenseNode) => ({
  id: sense.id,
  entry_id: sense.entryId,
  pos: sense.pos,
  created_by: sense.createdBy,
  created_at: sense.createdAt,
})

export const factDto = (fact: Fact): FactDto =>
  ({
    id: fact.id,
    kind: fact.kind,
    subject_id: fact.subjectId,
    object_id: fact.objectId,
    payload: fact.payload,
    status: fact.status,
    supersedes_id: fact.supersedesId,
    author: fact.author,
    review: fact.review,
    created_at: fact.createdAt,
    updated_at: fact.updatedAt,
  }) as FactDto

export const listedFactDto = (fact: WithEntry<Fact>): ListedFactDto => ({ ...factDto(fact), entry: fact.entry })

export const managedEntryDto = (view: ManagedEntryView) => ({
  entry: entryDto(view.entry),
  live: view.entry.live,
  batch: view.batch,
  completeness: view.completeness,
  credibility: view.credibility,
  slots: view.slots,
  senses: view.senses.map(senseDto),
  facts: view.facts.map(factDto),
})

export const ticketDto = (ticket: TicketRecord): TicketDto => ({
  id: ticket.id,
  type: ticket.type,
  target_type: ticket.targetType,
  target: ticket.target,
  message: ticket.message,
  status: ticket.status,
  resolution_note: ticket.resolutionNote,
  resolution_fact_ids: ticket.resolutionFactIds,
  created_at: ticket.createdAt,
  updated_at: ticket.updatedAt,
})

export const listedTicketDto = (
  ticket: TicketRecord & { entry: WithEntry<TicketRecord>['entry'] | null },
): ListedTicketDto => ({
  ...ticketDto(ticket),
  entry: ticket.entry,
})

export const agentDto = (agent: AgentRecord): AgentDto => ({
  id: agent.id,
  name: agent.name,
  curator: agent.curator,
  created_by: agent.createdBy,
  created_at: agent.createdAt,
  revoked_at: agent.revokedAt,
})

export const pageDto = <T, D>(page: Page<T>, map: (item: T) => D) => ({
  items: page.items.map(map),
  next_cursor: page.nextCursor,
})
