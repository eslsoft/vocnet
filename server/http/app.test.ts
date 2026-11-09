import { app } from '@server/app'
import type { Env } from '@server/env'
import { describe, expect, it } from 'vitest'

// OIDC config so createDeps' env validation passes; the DB throws on any query so
// these tests prove routing + the auth wall resolve before persistence is touched.
const env = {
  OIDC_ISSUER: 'https://issuer.test',
  OIDC_CLIENT_ID: 'test-client',
  DB: new Proxy(
    {},
    {
      get() {
        throw new Error('Unexpected database access in http wiring test.')
      },
    },
  ),
} as unknown as Env

function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  if (init?.body) headers.set('content-type', 'application/json')
  return app.fetch(new Request(`http://app.test${path}`, { ...init, headers }), env)
}

describe('http wiring', () => {
  it('serves the health check publicly', async () => {
    const response = await request('/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
  })

  it('rejects protected routes without a token [spec: auth/require-token]', async () => {
    expect((await request('/api/notes')).status).toBe(401)
    expect((await request('/api/me')).status).toBe(401)
    expect((await request('/api/notes', { method: 'POST', body: '{}' })).status).toBe(401)
  })
})
