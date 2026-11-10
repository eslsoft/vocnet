import type { ReadVariant } from '@server/domain/public-view'
import type { Context } from 'hono'

// HTTP caching of the public reads. A document read is one indexed lookup of a prebuilt view, so
// revalidation is cheap: a client or cache that holds the ETag gets 304 without the body.

/**
 * Entry, sense, and form reads. A write rebuilds the view within its own request, so a cache that
 * kept a document fresh for any time would serve it past that write; the staleness budget is a few
 * seconds. Every use revalidates instead, and the 304 for an unchanged ETag is one indexed lookup.
 */
export const DOCUMENT_CACHE = 'public, no-cache'

/**
 * Lists change whenever any entry in them does, and an ETag would cost the whole page query before
 * a 304 could save only the body; five seconds fresh stays within the staleness budget.
 */
export const LIST_CACHE = 'public, max-age=5'

/**
 * A strong ETag over the versions of what a response is cut from and the variant it asks for: the
 * first 16 bytes of their SHA-256 in hex, so it changes exactly when the body of that variant can.
 */
export async function etagOf(versions: string[], variant: ReadVariant): Promise<string> {
  const input = JSON.stringify([versions, variant.lang, variant.review])
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))
  return `"${[...hash.subarray(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}"`
}

/**
 * Sets the caching headers and answers 304 when the client's If-None-Match holds the ETag;
 * otherwise null, and the caller sends the body.
 */
export function notModified(c: Context, etag: string): Response | null {
  c.header('ETag', etag)
  c.header('Cache-Control', DOCUMENT_CACHE)
  const tags = c.req
    .header('if-none-match')
    ?.split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
  return tags?.some((tag) => tag === etag || tag === '*') ? c.body(null, 304) : null
}
