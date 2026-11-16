import { admin } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import { issueService, revokeService } from '@server/usecases/services'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { AppEnv } from './context'
import { onError } from './errors'
import { edgeCacheKey, publicReadBoundary } from './public-reads'

function harness() {
  const world = fakeWorld()
  let served = 0
  const app = new Hono<AppEnv>()
    .onError(onError)
    .use('*', async (c, next) => {
      c.set('deps', world.deps)
      await next()
    })
    .use('/v1/*', publicReadBoundary)
    .get('/v1/list', (c) => {
      served += 1
      c.header('Cache-Control', 'public, max-age=5')
      c.header('Vary', 'Accept-Language')
      return c.json({ served })
    })
    .get('/v1/tagged', (c) => {
      served += 1
      c.header('Cache-Control', 'public, max-age=5')
      c.header('ETag', '"v1"')
      return c.json({ served })
    })
    .get('/v1/document', (c) => {
      served += 1
      c.header('Cache-Control', 'public, no-cache')
      return c.json({ served })
    })
    .get('/v1/missing', (c) => c.json({ error: 'none' }, 404))
    .post('/v1/feedback', (c) => c.json({ ok: true }, 201))
  const pending: Promise<unknown>[] = []
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    passThroughOnException() {},
    props: {},
  }
  const send = async (path: string, headers: Record<string, string> = {}, method = 'GET') => {
    const response = await app.request(
      path,
      { method, headers: { 'cf-connecting-ip': '192.0.2.1', ...headers } },
      {},
      ctx,
    )
    await Promise.all(pending.splice(0))
    return response
  }
  return { world, send, served: () => served }
}

describe('public read boundary', () => {
  it('keys a read by its URL and, without ?lang=, the served language its Accept-Language reads [spec: public-view/edge-cache]', () => {
    expect(edgeCacheKey('http://a.test/v1/entries?limit=2', 'zh-CN,en;q=0.5')).toBe(
      'http://a.test/v1/entries?limit=2&lang=zh&vary=accept-language',
    )
    expect(edgeCacheKey('http://a.test/v1/entries', 'zh-Hans')).toBe(edgeCacheKey('http://a.test/v1/entries', 'zh'))
    expect(edgeCacheKey('http://a.test/v1/entries', 'zh-TW')).toBe(edgeCacheKey('http://a.test/v1/entries', undefined))
    expect(edgeCacheKey('http://a.test/v1/entries?lang=zh-TW', 'zh')).toBe('http://a.test/v1/entries?lang=zh-TW')
  })

  it('keeps lists at the edge for their max-age and serves hits with Age and Vary [spec: public-view/edge-cache]', async () => {
    const { world, send, served } = harness()
    const first = await send('/v1/list', { 'accept-language': 'zh-CN' })
    expect(await first.json()).toEqual({ served: 1 })
    expect([...world.cachedResponses.keys()]).toEqual(['http://localhost/v1/list?lang=zh&vary=accept-language'])
    const stored = world.cachedResponses.get('http://localhost/v1/list?lang=zh&vary=accept-language')
    expect(stored?.headers.get('Vary')).toBeNull()
    expect(stored?.headers.get('Date')).toBe(new Date('2026-01-01T00:00:00.000Z').toUTCString())

    world.setNow('2026-01-01T00:00:03.000Z')
    const hit = await send('/v1/list', { 'accept-language': 'zh' })
    expect(await hit.json()).toEqual({ served: 1 })
    expect(hit.headers.get('Age')).toBe('3')
    expect(hit.headers.get('Vary')).toBe('Accept-Language')
    expect(hit.headers.get('Cache-Control')).toBe('public, max-age=5')

    expect(await (await send('/v1/list')).json()).toEqual({ served: 2 })
    expect(served()).toBe(2)
  })

  it('answers a hit whose ETag the request holds with 304 and no body [spec: public-view/edge-cache]', async () => {
    const { send, served } = harness()
    expect(await (await send('/v1/tagged')).json()).toEqual({ served: 1 })
    const unchanged = await send('/v1/tagged', { 'if-none-match': 'W/"v1"' })
    expect([unchanged.status, await unchanged.text()]).toEqual([304, ''])
    expect([
      unchanged.headers.get('ETag'),
      unchanged.headers.get('Cache-Control'),
      unchanged.headers.get('Age'),
    ]).toEqual(['"v1"', 'public, max-age=5', '0'])
    expect(await (await send('/v1/tagged', { 'if-none-match': '"v0"' })).json()).toEqual({ served: 1 })
    // A list without an ETag is served whole whatever the request holds.
    await send('/v1/list')
    expect((await send('/v1/list', { 'if-none-match': '*' })).status).toBe(200)
    expect(served()).toBe(2)
  })

  it('stores no document, error, or HEAD response, and leaves other methods alone', async () => {
    const { world, send } = harness()
    await send('/v1/document')
    expect(await (await send('/v1/document')).json()).toEqual({ served: 2 })
    expect((await send('/v1/missing')).status).toBe(404)
    expect((await send('/v1/list', {}, 'HEAD')).status).toBe(200)
    expect(world.cachedResponses.size).toBe(0)
    expect((await send('/v1/feedback', {}, 'POST')).status).toBe(201)
  })

  it('answers 429 with Retry-After once an address used up its reads [spec: public-view/rate-limit]', async () => {
    const { world, send } = harness()
    world.limitedClients.add('192.0.2.1')
    const limited = await send('/v1/list')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('60')
    expect(await limited.json()).toMatchObject({ error: { code: 'rate_limited' } })
    expect((await send('/v1/list', { 'cf-connecting-ip': '192.0.2.2' })).status).toBe(200)
  })

  it('counts a read with a service key against the service, with or without a client address [spec: services/read-limit]', async () => {
    const { world, send } = harness()
    const { service, key } = await issueService(world.deps, admin, { name: 'wordkith' })
    const authorization = `Bearer ${key}`
    // The address has used up its reads; the service has its own allowance.
    world.limitedClients.add('192.0.2.1')
    expect((await send('/v1/list')).status).toBe(429)
    expect((await send('/v1/list', { authorization })).status).toBe(200)

    // No Cloudflare in front: a keyed read needs no CF-Connecting-IP.
    const bare = new Hono<AppEnv>()
      .onError(onError)
      .use('*', async (c, next) => {
        c.set('deps', world.deps)
        await next()
      })
      .use('*', publicReadBoundary)
      .get('/v1/who', (c) => c.json({ authMethod: c.get('authMethod'), service: c.get('service') }))
    const read = await bare.request('/v1/who', { headers: { authorization } })
    expect(await read.json()).toEqual({ authMethod: 'service_key', service: { id: service.id, name: 'wordkith' } })

    world.limitedClients.add(service.id)
    const limited = await send('/v1/list', { authorization, 'cf-connecting-ip': '192.0.2.9' })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('60')
    expect(await limited.json()).toMatchObject({
      error: { code: 'rate_limited', message: expect.stringContaining('this service') },
    })
  })

  it('refuses a read whose service key names no live service, and reads any other credential as none [spec: services/read-limit]', async () => {
    const { world, send } = harness()
    const { service, key } = await issueService(world.deps, admin, { name: 'wordkith' })
    const unknown = await send('/v1/list', { authorization: 'Bearer vn_service_unknown' })
    expect(unknown.status).toBe(401)
    expect(await unknown.json()).toMatchObject({ error: { code: 'invalid_credential' } })
    await revokeService(world.deps, service.id)
    expect((await send('/v1/list', { authorization: `Bearer ${key}` })).status).toBe(401)
    // An agent key or anything else is no read credential: the read is anonymous, by its address.
    expect((await send('/v1/list', { authorization: 'Bearer vn_agent_whatever' })).status).toBe(200)
    expect((await send('/v1/list', { authorization: 'Basic abc' })).status).toBe(200)
    world.limitedClients.add('192.0.2.1')
    expect((await send('/v1/list', { authorization: 'Bearer vn_agent_whatever' })).status).toBe(429)
  })

  it('fails loudly without a client address', async () => {
    const world = fakeWorld()
    const app = new Hono<AppEnv>()
      .use('*', async (c, next) => {
        c.set('deps', world.deps)
        await next()
      })
      .use('*', publicReadBoundary)
      .get('/v1/list', (c) => c.json({}))
    expect((await app.request('/v1/list')).status).toBe(500)
  })
})
