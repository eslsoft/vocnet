import { app } from '@server/app'
import { describe, expect, it } from 'vitest'

// No deps are wired: anything that reaches a use case fails loudly, so these
// tests prove routing, validation, and the auth wall resolve first.
const env = { OIDC_ISSUER: 'https://issuer.test', OIDC_CLIENT_ID: 'test-client' }

function request(path: string, init?: RequestInit) {
  return app.fetch(new Request(`http://app.test${path}`, init), env)
}

describe('http wiring', () => {
  it('rejects management routes without a credential', async () => {
    for (const path of ['/manage/v1/facts', '/manage/v1/agents', '/manage/openapi.json']) {
      const response = await request(path)
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({
        error: { code: 'authentication_required', message: 'Authentication required.' },
      })
    }
  })

  it('validates public input before touching storage', async () => {
    const response = await request('/v1/senses/not-a-uuid')
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } })
    const feedback = await request('/v1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_type: 'word', target_id: 'x', message: '' }),
    })
    expect(feedback.status).toBe(400)
  })

  it('answers unknown routes with a stable not_found error', async () => {
    const response = await request('/v1/nothing-here')
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } })
  })

  it('serves the public OpenAPI document generated from the routes', async () => {
    const response = await request('/openapi.json')
    const document = (await response.json()) as { openapi: string; paths: Record<string, unknown>; servers: unknown[] }
    expect(document.openapi).toBe('3.1.0')
    expect(document.servers).toEqual([{ url: '/v1' }])
    expect(Object.keys(document.paths).sort()).toEqual([
      '/entries',
      '/entries/{lemma}',
      '/feedback',
      '/forms/{form}',
      '/senses/{id}',
      '/topics',
      '/topics/{id}/senses',
    ])
    const docs = await request('/docs')
    expect(docs.status).toBe(200)
    expect(await docs.text()).toContain('/openapi.json')
  })

  it('serves public runtime config for the console', async () => {
    const response = await request('/configz')
    expect(await response.json()).toEqual({ oidc: { issuer: 'https://issuer.test', client_id: 'test-client' } })
  })
})
