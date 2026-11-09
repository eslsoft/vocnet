import type { ExecutionContext } from '@cloudflare/workers-types'
import type { Env } from '@server/env'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { app } from './app'
import { createDeps } from './composition'
import { secureBrowserResponse } from './http/browser-security'
import type { AppVariables } from './http/context'
import { onError } from './http/errors'
import { auditBoundary, requestBoundary } from './http/observability'

// Composition root: wire per-request deps, then delegate to the app. Kept out of
// app.ts so the exported AppType (consumed by the SPA's RPC client) carries no
// Workers-only types. Exported for integration tests that drive the full stack.
export const worker = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .onError(onError)
  .use('*', secureHeaders())
  .use('*', requestBoundary)
  .use('*', auditBoundary)
  .use('*', async (c, next) => {
    c.set('deps', createDeps(c.env))
    await next()
  })
  .route('/', app)

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      return worker.fetch(request, env, ctx)
    }
    return secureBrowserResponse(await env.ASSETS.fetch(request), env.OIDC_ISSUER)
  },
}
