import { admin } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import type { ServiceId } from '@shared/services'
import { describe, expect, it } from 'vitest'
import { authenticateStaff } from './access'
import { authenticateService, issueService, listServices, revokeService } from './services'

describe('services', () => {
  it('issues a service key shown once and stores only its hash [spec: services/issue]', async () => {
    const world = fakeWorld()
    const { service, key } = await issueService(world.deps, admin, { name: 'wordkith' })
    expect(key).toMatch(/^vn_service_/)
    expect(service).toMatchObject({ name: 'wordkith', createdBy: 'admin:admin-1', revokedAt: null })
    expect(world.services[0]?.keyHash).toBe(`hash(${key})`)
    expect(JSON.stringify(await listServices(world.deps))).not.toContain(key)
  })

  it('revokes a service key once and keeps the first revocation time [spec: services/revoke]', async () => {
    const world = fakeWorld()
    const { service } = await issueService(world.deps, admin, { name: 'wordkith' })
    await expect(revokeService(world.deps, service.id)).resolves.toMatchObject({
      revokedAt: '2026-01-01T00:00:00.000Z',
    })
    world.setNow('2026-02-01T00:00:00.000Z')
    await expect(revokeService(world.deps, service.id)).resolves.toMatchObject({
      revokedAt: '2026-01-01T00:00:00.000Z',
    })
    await expect(revokeService(world.deps, 'missing' as ServiceId)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('names the service of a live key and refuses unknown or revoked ones [spec: services/authenticate]', async () => {
    const world = fakeWorld()
    const { service, key } = await issueService(world.deps, admin, { name: 'wordkith' })
    await expect(authenticateService(world.deps, key)).resolves.toMatchObject({ id: service.id, name: 'wordkith' })
    await expect(authenticateService(world.deps, 'vn_service_unknown')).rejects.toMatchObject({
      code: 'invalid_credential',
    })
    // A service key reads; it is no management credential.
    await expect(authenticateStaff(world.deps, key)).rejects.toThrow()
    await revokeService(world.deps, service.id)
    await expect(authenticateService(world.deps, key)).rejects.toMatchObject({ code: 'invalid_credential' })
  })
})
