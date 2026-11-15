import { principalRef, SERVICE_KEY_PREFIX } from '@server/domain/principal'
import type { IssueServiceInput, ServiceId } from '@shared/services'
import type { Deps } from './deps'
import { InvalidCredentialError, NotFoundError } from './errors'
import type { Actor } from './facts'
import type { ServiceRecord } from './ports'

/** Issues a service key, hashed as agent keys are. The key is returned once; only its hash is stored. */
export async function issueService(
  deps: Pick<Deps, 'services' | 'agentKeys' | 'clock' | 'ids'>,
  actor: Actor,
  input: IssueServiceInput,
): Promise<{ service: ServiceRecord; key: string }> {
  const key = `${SERVICE_KEY_PREFIX}${deps.agentKeys.randomSecret()}`
  const service: ServiceRecord = {
    id: deps.ids.service(),
    name: input.name,
    createdBy: principalRef(actor.principal),
    createdAt: deps.clock.now().toISOString(),
    revokedAt: null,
  }
  await deps.services.insert(service, await deps.agentKeys.hash(key))
  return { service, key }
}

export function listServices(deps: Pick<Deps, 'services'>): Promise<ServiceRecord[]> {
  return deps.services.list()
}

/** Revokes a service's key. Revoking twice keeps the first revocation time. */
export async function revokeService(deps: Pick<Deps, 'services' | 'clock'>, id: ServiceId): Promise<ServiceRecord> {
  const service = await deps.services.find(id)
  if (!service) throw new NotFoundError(`Service ${id} not found.`)
  if (service.revokedAt) return service
  const revokedAt = deps.clock.now().toISOString()
  await deps.services.revoke(id, revokedAt)
  return { ...service, revokedAt }
}

/**
 * The service a key names. A key that names none, or a revoked one, is an invalid credential: a
 * read that presents a key never falls back to an anonymous read.
 */
export async function authenticateService(
  deps: Pick<Deps, 'services' | 'agentKeys'>,
  key: string,
): Promise<ServiceRecord> {
  const service = await deps.services.findByKeyHash(await deps.agentKeys.hash(key))
  if (!service || service.revokedAt) throw new InvalidCredentialError('Unknown or revoked service key.')
  return service
}
