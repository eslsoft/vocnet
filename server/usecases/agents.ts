import { AGENT_KEY_PREFIX, principalRef } from '@server/domain/principal'
import type { AgentId, IssueAgentInput } from '@shared/agents'
import type { Deps } from './deps'
import { NotFoundError } from './errors'
import type { Actor } from './facts'
import type { AgentRecord } from './ports'

/** Issues an agent key. The key is returned once; only its hash is stored. */
export async function issueAgent(
  deps: Pick<Deps, 'agents' | 'agentKeys' | 'clock' | 'ids'>,
  actor: Actor,
  input: IssueAgentInput,
): Promise<{ agent: AgentRecord; key: string }> {
  const key = `${AGENT_KEY_PREFIX}${deps.agentKeys.randomSecret()}`
  const agent: AgentRecord = {
    id: deps.ids.agent(),
    name: input.name,
    createdBy: principalRef(actor.principal),
    createdAt: deps.clock.now().toISOString(),
    revokedAt: null,
  }
  await deps.agents.insert(agent, await deps.agentKeys.hash(key))
  return { agent, key }
}

export function listAgents(deps: Pick<Deps, 'agents'>): Promise<AgentRecord[]> {
  return deps.agents.list()
}

/** Revokes an agent's key. Revoking twice keeps the first revocation time. */
export async function revokeAgent(deps: Pick<Deps, 'agents' | 'clock'>, id: AgentId): Promise<AgentRecord> {
  const agent = await deps.agents.find(id)
  if (!agent) throw new NotFoundError(`Agent ${id} not found.`)
  if (agent.revokedAt) return agent
  const revokedAt = deps.clock.now().toISOString()
  await deps.agents.revoke(id, revokedAt)
  return { ...agent, revokedAt }
}
