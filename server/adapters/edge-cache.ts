import type { Cache } from '@cloudflare/workers-types'
import type { ResponseCache } from '@server/usecases/ports'

/** The Workers Cache API of the colo serving the request, which honors each response's Cache-Control. */
export function createEdgeCache(cache: Cache): ResponseCache {
  return {
    // The Workers and DOM Response types differ only in declaration; the runtime has one Response.
    match: async (key) => (await cache.match(key)) as unknown as Response | undefined,
    put: (key, response) => cache.put(key, response as unknown as Parameters<Cache['put']>[1]),
  }
}
