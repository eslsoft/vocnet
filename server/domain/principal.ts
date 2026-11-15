import type { AgentId } from '@shared/agents'

/**
 * Who acts: an admin, an agent, or the server itself filling a slot it classifies (`classifier`),
 * which no request authenticates as.
 */
export type Principal =
  | { kind: 'admin'; sub: string }
  | { kind: 'agent'; agentId: AgentId; name: string; curator: boolean }
  | { kind: 'system'; name: 'classifier' }

/** How a principal is recorded as author, creator, or assignee. */
export type PrincipalRef = `admin:${string}` | `agent:${string}` | `system:${string}`

export const CLASSIFIER: Principal = { kind: 'system', name: 'classifier' }

export function principalRef(principal: Principal): PrincipalRef {
  if (principal.kind === 'admin') return `admin:${principal.sub}`
  if (principal.kind === 'agent') return `agent:${principal.agentId}`
  return `system:${principal.name}`
}

/** Admins act on anything; anyone else acts only on what it owns. */
export function mayActOn(principal: Principal, owner: string): boolean {
  return principal.kind === 'admin' || principalRef(principal) === owner
}

/** Admins and the agents an admin made curators settle facts by hand, outside the reviewer chain. */
export function mayCurate(principal: Principal): boolean {
  return principal.kind === 'admin' || (principal.kind === 'agent' && principal.curator)
}

export const AGENT_KEY_PREFIX = 'vn_agent_'

export function isAgentKey(token: string): boolean {
  return token.startsWith(AGENT_KEY_PREFIX)
}

/** A service key reads the public API as a named downstream service; it is no management credential. */
export const SERVICE_KEY_PREFIX = 'vn_service_'

export function isServiceKey(token: string): boolean {
  return token.startsWith(SERVICE_KEY_PREFIX)
}
