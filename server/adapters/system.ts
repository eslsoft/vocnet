import type { Clock, IdGenerator } from '@server/usecases/ports'
import type { AgentId } from '@shared/agents'
import type { EntryId, FactId, SenseId, SentenceId } from '@shared/facts'
import type { TicketId } from '@shared/tickets'
import type { WorkLeaseId } from '@shared/work'

export const systemClock: Clock = { now: () => new Date() }

export const uuidGenerator: IdGenerator = {
  entry: () => crypto.randomUUID() as EntryId,
  sense: () => crypto.randomUUID() as SenseId,
  sentence: () => crypto.randomUUID() as SentenceId,
  fact: () => crypto.randomUUID() as FactId,
  ticket: () => crypto.randomUUID() as TicketId,
  agent: () => crypto.randomUUID() as AgentId,
  lease: () => crypto.randomUUID() as WorkLeaseId,
}
