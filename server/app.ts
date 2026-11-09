import { Hono } from 'hono'
import { configRoutes } from './http/config'
import type { AppEnv } from './http/context'
import { onError } from './http/errors'
import { requireAuth } from './http/middleware'
import { notesRoutes } from './http/notes'

// Routes are chained (not registered via side-effecting functions) so their types
// flow into `AppType`, which the SPA's Hono RPC client consumes. Per-request deps
// are wired by the worker; see server/worker.ts.
const api = new Hono<AppEnv>()
  .get('/health', (c) => c.json({ ok: true, name: 'vocnet' }))
  .route('/', configRoutes)
  // Everything below requires a valid bearer token.
  .use('*', requireAuth)
  .get('/me', (c) => c.json({ user: c.get('user') }))
  .route('/', notesRoutes)

export const app = new Hono<AppEnv>().onError(onError).route('/api', api)

export type AppType = typeof app
