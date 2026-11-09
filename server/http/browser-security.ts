export function secureBrowserResponse(response: Response, oidcIssuer: string): Response {
  const issuerOrigin = new URL(oidcIssuer).origin
  const headers = new Headers(response.headers)
  headers.set(
    'content-security-policy',
    `default-src 'self'; base-uri 'self'; connect-src 'self' ${issuerOrigin}; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'`,
  )
  headers.set('referrer-policy', 'no-referrer')
  headers.set('x-content-type-options', 'nosniff')
  headers.set('x-frame-options', 'DENY')
  return new Response(response.body, { headers, status: response.status, statusText: response.statusText })
}
