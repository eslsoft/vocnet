import { RateLimitedError } from '@server/usecases/errors'
import { LIMIT_PERIOD_SECONDS } from '@server/usecases/ports'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from './context'
import { negotiatedLanguage } from './language'

// The boundary of every public read: a per-address rate limit, then the edge cache. Documents are
// `no-cache`, so only what a response's own headers let a shared cache keep fresh is stored: the
// lists, search, for their five-second max-age.

/** The response may be kept fresh by a shared cache: public with a max-age, and not no-cache or no-store. */
function sharedFresh(cacheControl: string | null): boolean {
  const directives = (cacheControl ?? '').split(',').map((directive) => directive.trim().toLowerCase())
  return (
    directives.includes('public') &&
    directives.some((directive) => /^max-age=[1-9]\d*$/.test(directive)) &&
    !directives.some((directive) => directive === 'no-cache' || directive === 'no-store' || directive === 'private')
  )
}

/**
 * The key of a read in the edge cache: its URL, and when it has no ?lang= the served language its
 * Accept-Language reads, the only part of that header the body depends on. The Cache API ignores
 * Vary, so the language goes into the key. A ?lang= value stays in the URL as sent, so a value the
 * route rejects never shares a key with one it serves.
 */
export function edgeCacheKey(url: string, acceptLanguage: string | undefined): string {
  const key = new URL(url)
  if (!key.searchParams.has('lang')) {
    key.searchParams.set('lang', negotiatedLanguage(acceptLanguage) ?? '')
    key.searchParams.set('vary', 'accept-language')
  }
  return key.toString()
}

/** A stored copy of the response: without Vary, which the key already covers, and dated for Age. */
function stored(response: Response, now: Date): Response {
  const copy = new Response(response.clone().body, response)
  copy.headers.delete('Vary')
  copy.headers.set('Date', now.toUTCString())
  return copy
}

/** A cache hit as served: its Vary restored and its Age, so downstream caches keep it only for what is left of max-age. */
function served(hit: Response, now: Date): Response {
  const response = new Response(hit.body, hit)
  const age = Math.max(0, Math.floor((now.getTime() - Date.parse(hit.headers.get('Date') ?? '')) / 1000))
  response.headers.set('Age', String(age))
  response.headers.set('Vary', 'Accept-Language')
  return response
}

export const publicReadBoundary: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next()
  const { readLimiter, responseCache, clock } = c.get('deps')
  const client = c.req.header('cf-connecting-ip')
  if (!client) throw new Error('CF-Connecting-IP is missing; the Worker must run behind Cloudflare.')
  if (!(await readLimiter.allow(client))) {
    throw new RateLimitedError('Too many requests from this address; try again in a minute.', LIMIT_PERIOD_SECONDS)
  }
  if (c.req.method === 'HEAD') return next()
  const key = edgeCacheKey(c.req.url, c.req.header('accept-language'))
  const hit = await responseCache.match(key)
  if (hit) return served(hit, clock.now())
  await next()
  if (c.res.status === 200 && sharedFresh(c.res.headers.get('Cache-Control'))) {
    c.executionCtx.waitUntil(responseCache.put(key, stored(c.res, clock.now())))
  }
}
