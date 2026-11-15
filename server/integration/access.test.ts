import { createExecutionContext, env } from 'cloudflare:test'
import entry from '@server/worker'
import { agentListSchema, agentSchema } from '@shared/agents'
import { issuedServiceSchema, serviceListSchema, serviceSchema } from '@shared/services'
import { apiErrorSchema } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { adminToken, call, issueAgentKey, request } from './helpers'

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

  it('reads the public API with a service key, counted per service, with no client address [spec: services/read-api]', async () => {
    const admin = await adminToken()
    const issued = await call('/manage/v1/services', { method: 'POST', token: admin, json: { name: 'wordkith' } })
    expect(issued.status).toBe(201)
    const { service, key } = issuedServiceSchema.parse(issued.body)
    expect(key).toMatch(/^vn_service_/)
    expect(serviceListSchema.parse((await call('/manage/v1/services', { token: admin })).body).items).toEqual([service])

    // As a container or a local process calls it: no Cloudflare in front, so no CF-Connecting-IP.
    const read = (token?: string, bindings: Partial<typeof env> = {}) =>
      entry.fetch(
        new Request('http://app.test/v1/topics', { headers: token ? { authorization: `Bearer ${token}` } : {} }),
        { ...env, ...bindings },
        createExecutionContext(),
      )
    expect((await read(key)).status).toBe(200)
    expect((await read()).status).toBe(500)
    expect((await read('vn_service_unknown')).status).toBe(401)

    // The service has its own allowance, keyed by its id, whatever the address limit says.
    const limiter = (allowed: string[]) => ({
      limit: async ({ key: counted }: { key: string }) => ({ success: allowed.includes(counted) }),
    })
    const keyed = (bindings: Partial<typeof env>) => request('/v1/topics', { token: key, bindings })
    expect((await keyed({ READ_RATE_LIMITER: limiter([]) })).status).toBe(200)
    const limited = await keyed({ SERVICE_READ_RATE_LIMITER: limiter([]) })
    expect([limited.status, limited.headers.get('Retry-After')]).toEqual([429, '60'])
    expect((await keyed({ SERVICE_READ_RATE_LIMITER: limiter([service.id]) })).status).toBe(200)

    // The key reads; it is no management credential, and only admins administer services.
    expect((await call('/manage/v1/facts', { token: key })).status).toBe(401)
    expect((await call('/manage/v1/services', { token: await issueAgentKey('not an admin') })).status).toBe(403)

    const revoked = serviceSchema.parse(
      (await call(`/manage/v1/services/${service.id}`, { method: 'DELETE', token: admin })).body,
    )
    expect(revoked.revoked_at).not.toBeNull()
    expect((await read(key)).status).toBe(401)
    expect(
      (await call('/manage/v1/services/00000000-0000-4000-8000-000000000999', { method: 'DELETE', token: admin }))
        .status,
    ).toBe(404)
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
