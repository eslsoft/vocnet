import type { Actor } from '@server/usecases/facts'
import type { AgentId } from '@shared/agents'

export const agentA: Actor = {
  principal: { kind: 'agent', agentId: 'agent-a' as AgentId, name: 'Agent A' },
  traceId: 'trace-a',
}
export const agentB: Actor = {
  principal: { kind: 'agent', agentId: 'agent-b' as AgentId, name: 'Agent B' },
  traceId: 'trace-b',
}
export const admin: Actor = { principal: { kind: 'admin', sub: 'admin-1' }, traceId: 'trace-admin' }
