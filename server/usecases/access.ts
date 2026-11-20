import { isAgentKey, mayCurate, type Principal } from '@server/domain/principal'
import type { Deps } from './deps'
import { ForbiddenError, InvalidCredentialError } from './errors'

/**
 * Resolves a management bearer credential to a principal. Agent keys are looked
 * up by hash and must not be revoked; anything else must be an OIDC token whose
 * subject is a configured admin.
 */
export async function authenticateStaff(
  deps: Pick<Deps, 'agents' | 'agentKeys' | 'authVerifier' | 'adminSubjects'>,
  token: string,
): Promise<Principal> {
  if (isAgentKey(token)) {
    const agent = await deps.agents.findByKeyHash(await deps.agentKeys.hash(token))
    if (!agent || agent.revokedAt) throw new InvalidCredentialError('Unknown or revoked agent key.')
    return { kind: 'agent', agentId: agent.id, name: agent.name, curator: agent.curator }
  }
  const user = await deps.authVerifier.verify(token)
  if (!deps.adminSubjects.has(user.sub)) throw new ForbiddenError('The management API is for admins and agents.')
  return { kind: 'admin', sub: user.sub }
}

export function requireAdminPrincipal(principal: Principal): void {
  if (principal.kind !== 'admin') throw new ForbiddenError('Only admins may do this.')
}

export function requireCurator(principal: Principal): void {
  if (!mayCurate(principal)) throw new ForbiddenError('Only curators (admins and curator agents) may do this.')
}
