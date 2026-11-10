import type { Actor } from '@server/usecases/facts'
import type { AgentId } from '@shared/agents'

export const agentA: Actor = {
  principal: { kind: 'agent', agentId: 'agent-a' as AgentId, name: 'Agent A', curator: false },
  traceId: 'trace-a',
}
export const agentB: Actor = {
  principal: { kind: 'agent', agentId: 'agent-b' as AgentId, name: 'Agent B', curator: false },
  traceId: 'trace-b',
}
export const admin: Actor = { principal: { kind: 'admin', sub: 'admin-1' }, traceId: 'trace-admin' }
export const curatorAgent: Actor = {
  principal: { kind: 'agent', agentId: 'agent-c' as AgentId, name: 'Curator', curator: true },
  traceId: 'trace-c',
}
