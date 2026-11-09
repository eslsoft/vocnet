import { admin } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import type { AgentId } from '@shared/agents'
import { describe, expect, it } from 'vitest'
import { authenticateStaff, requireAdminPrincipal } from './access'
import { issueAgent, listAgents, revokeAgent } from './agents'

describe('agents', () => {
  it('issues a key shown once and stores only its hash [spec: agents/issue]', async () => {
    const world = fakeWorld()
    const { agent, key } = await issueAgent(world.deps, admin, { name: 'Lexicographer' })
    expect(key).toMatch(/^vn_agent_/)
    expect(agent).toMatchObject({ name: 'Lexicographer', createdBy: 'admin:admin-1', revokedAt: null })
    expect(world.agents[0]?.keyHash).toBe(`hash(${key})`)
    expect(JSON.stringify(await listAgents(world.deps))).not.toContain(key)
  })

  it('revokes a key once and keeps the first revocation time [spec: agents/revoke]', async () => {
    const world = fakeWorld()
    const { agent } = await issueAgent(world.deps, admin, { name: 'bot' })
    const revoked = await revokeAgent(world.deps, agent.id)
    expect(revoked.revokedAt).toBe('2026-01-01T00:00:00.000Z')
    world.setNow('2026-02-01T00:00:00.000Z')
    await expect(revokeAgent(world.deps, agent.id)).resolves.toMatchObject({ revokedAt: '2026-01-01T00:00:00.000Z' })
    await expect(revokeAgent(world.deps, 'missing' as AgentId)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('authenticateStaff', () => {
  it('accepts a live agent key and rejects unknown or revoked ones [spec: access/agent-key]', async () => {
    const world = fakeWorld()
    const { agent, key } = await issueAgent(world.deps, admin, { name: 'bot' })
    await expect(authenticateStaff(world.deps, key)).resolves.toEqual({ kind: 'agent', agentId: agent.id, name: 'bot' })
    await expect(authenticateStaff(world.deps, 'vn_agent_unknown')).rejects.toMatchObject({
      code: 'invalid_credential',
    })
    await revokeAgent(world.deps, agent.id)
    await expect(authenticateStaff(world.deps, key)).rejects.toMatchObject({ code: 'invalid_credential' })
  })

  it('accepts OIDC tokens only for configured admin subjects [spec: access/admin-subjects]', async () => {
    const world = fakeWorld()
    await expect(authenticateStaff(world.deps, 'oidc:admin-1')).resolves.toEqual({ kind: 'admin', sub: 'admin-1' })
    await expect(authenticateStaff(world.deps, 'oidc:someone')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('reserves admin-only operations for admins', () => {
    expect(() => requireAdminPrincipal({ kind: 'admin', sub: 'a' })).not.toThrow()
    expect(() => requireAdminPrincipal({ kind: 'agent', agentId: 'x' as AgentId, name: 'n' })).toThrow('Only admins')
  })
})
