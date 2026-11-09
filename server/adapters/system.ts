import type { Clock, IdGenerator } from '@server/usecases/ports'
import type { AgentId } from '@shared/agents'
import type { EntryId, FactId, SenseId } from '@shared/facts'
import type { FeedbackId } from '@shared/feedback'
import type { WorkLeaseId } from '@shared/work'

export const systemClock: Clock = { now: () => new Date() }

export const uuidGenerator: IdGenerator = {
  entry: () => crypto.randomUUID() as EntryId,
  sense: () => crypto.randomUUID() as SenseId,
  fact: () => crypto.randomUUID() as FactId,
  feedback: () => crypto.randomUUID() as FeedbackId,
  agent: () => crypto.randomUUID() as AgentId,
  lease: () => crypto.randomUUID() as WorkLeaseId,
}
