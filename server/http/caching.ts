import type { Context } from 'hono'

// HTTP caching of the public reads. A document read is one indexed lookup of a prebuilt view, so
// revalidation is cheap: a client or cache that holds the ETag gets 304 without the body.

/**
 * Entry, sense, and form reads. A minute fresh keeps the edge and browsers close to the view,
 * which a write rebuilds within its own request; another five minutes stale while revalidating
 * lets a cache answer at once and refetch in the background.
 */
export const DOCUMENT_CACHE = 'public, max-age=60, stale-while-revalidate=300'

/** Lists change whenever any entry in them does, so they stay fresh for less time and have no ETag. */
export const LIST_CACHE = 'public, max-age=15, stale-while-revalidate=60'

/** A strong ETag over the digests of the entry documents a response is cut from. */
export const etagOf = (digests: string[]) => `"${digests.join('.')}"`

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
