/**
 * The absolute media base a request's URLs are composed under: `MEDIA_BASE_URL` as it is when it is
 * an absolute URL, and resolved against the request's origin when it is a path, so every picture
 * URL a response gives is absolute.
 */
export function absoluteMediaBase(base: string, requestUrl: string): string {
  // A bare origin's href ends in the slash a path would follow; the base never does.
  return new URL(base, requestUrl).href.replace(/\/$/, '')
}
