// The Vite dev server injects React Fast Refresh as an inline script; only `vite dev`
// relaxes script-src for it. Production builds never set devServer.
export function secureBrowserResponse(response: Response, oidcIssuer: string, devServer: boolean): Response {
  const issuerOrigin = new URL(oidcIssuer).origin
  const scriptSrc = devServer ? "'self' 'unsafe-inline'" : "'self'"
  const headers = new Headers(response.headers)
  headers.set(
    'content-security-policy',
    `default-src 'self'; base-uri 'self'; connect-src 'self' ${issuerOrigin}; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'`,
  )
  headers.set('referrer-policy', 'no-referrer')
  headers.set('x-content-type-options', 'nosniff')
  headers.set('x-frame-options', 'DENY')
  return new Response(response.body, { headers, status: response.status, statusText: response.statusText })
}
