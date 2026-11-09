import { env } from 'cloudflare:test'
import { worker } from '@server/worker'
import { importJWK, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'

async function bearer(claims: { sub?: string; email?: string } = {}) {
  const key = await importJWK(JSON.parse(env.TEST_PRIVATE_JWK), 'ES256')
  const token = await new SignJWT({ email: claims.email ?? 'user@test' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test' })
    .setSubject(claims.sub ?? 'user-1')
    .setIssuer('https://issuer.test')
    .setAudience('test-client')
    .setExpirationTime('5m')
    .sign(key)
  return `Bearer ${token}`
}

async function request(path: string, init?: RequestInit & { auth?: boolean; sub?: string }) {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  if (init?.auth) headers.set('authorization', await bearer({ sub: init.sub }))
  return worker.fetch(new Request(`http://app.test${path}`, { ...init, headers }), env)
}

describe('config', () => {
  it('serves public runtime config without a token', async () => {
    const response = await request('/api/configz')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ oidc: { issuer: 'https://issuer.test', clientId: 'test-client' } })
  })
})

describe('auth', () => {
  it('rejects requests without a token [spec: auth/require-token]', async () => {
    const response = await request('/api/notes')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: { code: 'authentication_required', message: 'Authentication required.' },
    })
    expect((await request('/api/me')).status).toBe(401)
  })

  it('rejects an invalid token [spec: auth/require-token]', async () => {
    const response = await request('/api/me', { headers: { authorization: 'Bearer not-a-jwt' } })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: { code: 'invalid_credential', message: 'Invalid credential.' } })
  })

  it('accepts a valid token and returns the user [spec: auth/me]', async () => {
    const response = await request('/api/me', { auth: true })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ user: { sub: 'user-1', email: 'user@test', name: null } })
  })
})

describe('notes api', () => {
  it('starts empty, then lists a created note [spec: notes/create]', async () => {
    expect(await (await request('/api/notes', { auth: true })).json()).toEqual({ items: [], nextCursor: null })

    const created = await request('/api/notes', {
      method: 'POST',
      auth: true,
      body: JSON.stringify({ text: '  hello   world ' }),
    })
    expect(created.status).toBe(201)
    const createdBody = (await created.json()) as { item: { text: string } }
    expect(createdBody.item).toMatchObject({ text: 'hello world' })

    const list = (await (await request('/api/notes', { auth: true })).json()) as { items: Array<{ text: string }> }
    expect(list.items.map((note) => note.text)).toEqual(['hello world'])
  })

  it('scopes notes to their owner [spec: notes/owner-scope]', async () => {
    await request('/api/notes', { method: 'POST', auth: true, sub: 'user-1', body: JSON.stringify({ text: 'mine' }) })

    const others = (await (await request('/api/notes', { auth: true, sub: 'user-2' })).json()) as { items: unknown[] }
    expect(others.items).toEqual([])
  })

  it('paginates with a cursor [spec: notes/paginate]', async () => {
    for (const text of ['a', 'b', 'c']) {
      await request('/api/notes', { method: 'POST', auth: true, body: JSON.stringify({ text }) })
    }

    const seen: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 5; page++) {
      const path = cursor ? `/api/notes?limit=2&cursor=${encodeURIComponent(cursor)}` : '/api/notes?limit=2'
      const body = (await (await request(path, { auth: true })).json()) as {
        items: Array<{ text: string }>
        nextCursor: string | null
      }
      seen.push(...body.items.map((note) => note.text))
      cursor = body.nextCursor
      if (!cursor) break
    }

    expect(seen.sort()).toEqual(['a', 'b', 'c'])
  })

  it('rejects an empty note [spec: notes/validate]', async () => {
    const response = await request('/api/notes', { method: 'POST', auth: true, body: JSON.stringify({ text: '   ' }) })
    expect(response.status).toBe(400)
  })

  it('rejects a malformed cursor instead of starting over [spec: notes/invalid-cursor]', async () => {
    const response = await request('/api/notes?cursor=broken', { auth: true })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { code: 'invalid_cursor', message: 'Invalid pagination cursor.' },
    })
  })
})
