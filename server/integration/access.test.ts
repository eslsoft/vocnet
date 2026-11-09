import { agentListSchema, agentSchema } from '@shared/agents'
import { apiErrorSchema } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { adminToken, call, issueAgentKey } from './helpers'

describe('access', () => {
  it('serves the public API and docs without a credential [spec: access/public]', async () => {
    expect((await call('/v1/entries')).status).toBe(200)
    const document = (await call('/openapi.json')).body as { paths: Record<string, unknown> }
    expect(Object.keys(document.paths)).toContain('/entries/{lemma}')
  })

  it('rejects management calls without a valid credential [spec: access/manage-401]', async () => {
    for (const token of [undefined, 'not-a-jwt', 'vn_agent_unknown']) {
      const { status, body } = await call('/manage/v1/facts', { token })
      expect(status).toBe(401)
      expect(['authentication_required', 'invalid_credential']).toContain(apiErrorSchema.parse(body).error.code)
    }
  })

  it('forbids a valid OIDC token whose subject is not an admin [spec: access/manage-403]', async () => {
    const { status, body } = await call('/manage/v1/facts', { token: await adminToken('stranger') })
    expect(status).toBe(403)
    expect(apiErrorSchema.parse(body).error.code).toBe('forbidden')
  })

  it('accepts an issued agent key and serves it the management OpenAPI document [spec: access/agent-key-api]', async () => {
    const token = await issueAgentKey()
    expect((await call('/manage/v1/facts', { token })).status).toBe(200)
    const document = (await call('/manage/openapi.json', { token })).body as {
      servers: unknown[]
      paths: Record<string, unknown>
    }
    expect(document.servers).toEqual([{ url: '/manage/v1' }])
    expect(Object.keys(document.paths)).toContain('/facts/{id}/retract')
  })

  it('keeps agent administration to admins and rejects revoked keys [spec: agents/admin-only]', async () => {
    const token = await issueAgentKey('revocable')
    expect((await call('/manage/v1/agents', { token })).status).toBe(403)

    const admin = await adminToken('admin-2')
    const [agent] = agentListSchema.parse((await call('/manage/v1/agents', { token: admin })).body).items
    const revoked = agentSchema.parse(
      (await call(`/manage/v1/agents/${agent?.id}`, { method: 'DELETE', token: admin })).body,
    )
    expect(revoked.revoked_at).not.toBeNull()
    expect((await call('/manage/v1/facts', { token })).status).toBe(401)
  })
})
