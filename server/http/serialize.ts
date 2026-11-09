import type { ManagedEntryView } from '@server/domain/catalog-view'
import type { Fact } from '@server/domain/fact'
import type { FeedbackRecord } from '@server/domain/feedback'
import type { EntryNode, SenseNode } from '@server/domain/nodes'
import type { AgentRecord, Page } from '@server/usecases/ports'
import type { AgentDto } from '@shared/agents'
import type { FactDto } from '@shared/facts'
import type { FeedbackDto } from '@shared/feedback'

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

export const managedEntryDto = (view: ManagedEntryView) => ({
  entry: entryDto(view.entry),
  senses: view.senses.map(senseDto),
  facts: view.facts.map(factDto),
})

export const feedbackDto = (item: FeedbackRecord): FeedbackDto => ({
  id: item.id,
  target_type: item.targetType,
  target_id: item.targetId,
  message: item.message,
  status: item.status,
  assignee: item.assignee,
  claim_expires_at: item.claimExpiresAt,
  resolution_note: item.resolutionNote,
  resolution_fact_ids: item.resolutionFactIds,
  created_at: item.createdAt,
  updated_at: item.updatedAt,
})

export const agentDto = (agent: AgentRecord): AgentDto => ({
  id: agent.id,
  name: agent.name,
  created_by: agent.createdBy,
  created_at: agent.createdAt,
  revoked_at: agent.revokedAt,
})

export const pageDto = <T, D>(page: Page<T>, map: (item: T) => D) => ({
  items: page.items.map(map),
  next_cursor: page.nextCursor,
})
