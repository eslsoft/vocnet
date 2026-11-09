import type { AgentId } from '@shared/agents'

export type Principal = { kind: 'admin'; sub: string } | { kind: 'agent'; agentId: AgentId; name: string }

/** How a principal is recorded as author, creator, or assignee. */
export type PrincipalRef = `admin:${string}` | `agent:${string}`

export function principalRef(principal: Principal): PrincipalRef {
  return principal.kind === 'admin' ? `admin:${principal.sub}` : `agent:${principal.agentId}`
}

/** Admins act on anything; an agent acts only on what it owns. */
export function mayActOn(principal: Principal, owner: string): boolean {
  return principal.kind === 'admin' || principalRef(principal) === owner
}

export const AGENT_KEY_PREFIX = 'vn_agent_'

export function isAgentKey(token: string): boolean {
  return token.startsWith(AGENT_KEY_PREFIX)
}
