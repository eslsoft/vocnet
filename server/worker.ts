import type { ExecutionContext, Message, MessageBatch, ScheduledController } from '@cloudflare/workers-types'
import type { Env } from '@server/env'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { type ReviewMessage, reviewMessageSchema } from './adapters/review-queue'
import { app } from './app'
import { createDeps } from './composition'
import { secureBrowserResponse } from './http/browser-security'
import type { AppVariables } from './http/context'
import { onError } from './http/errors'
import { auditBoundary, requestBoundary } from './http/observability'
import { ReviewerTransportError } from './usecases/ports'
import { reconcileReviews, reviewFact } from './usecases/review'
import { refreshStaleWork } from './usecases/work-scores'

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

const API_PREFIXES = ['/v1/', '/manage/']
const API_PATHS = new Set(['/openapi.json', '/docs', '/configz'])

export function isApiPath(pathname: string): boolean {
  return API_PATHS.has(pathname) || API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

const RETRY_DELAY_SECONDS = 60

// Messages in a batch are independent and each review is idempotent, so they run
// concurrently; a sequential loop made one slow model call hold up the whole batch.
export async function handleReviewBatch(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  const deps = createDeps(env)
  await Promise.all(batch.messages.map((message) => handleReviewMessage(deps, message)))
}

async function handleReviewMessage(deps: ReturnType<typeof createDeps>, message: Message<unknown>): Promise<void> {
  const parsed = reviewMessageSchema.safeParse(message.body)
  if (!parsed.success) {
    console.error(JSON.stringify({ event: 'review_job_invalid', messageId: message.id, issues: parsed.error.issues }))
    message.ack()
    return
  }
  const job: ReviewMessage = parsed.data
  const log = { event: 'review_job', factId: job.fact_id, traceId: job.trace_id, attempt: message.attempts }
  try {
    const outcome = await reviewFact(deps, job.fact_id, job.trace_id)
    console.info(JSON.stringify({ ...log, outcome }))
    message.ack()
  } catch (error) {
    const err = error as Error
    const transport = error instanceof ReviewerTransportError
    const entry = { ...log, outcome: 'retry', error: { name: err.name, message: err.message, stack: err.stack } }
    if (transport) console.warn(JSON.stringify(entry))
    else console.error(JSON.stringify(entry))
    message.retry({ delaySeconds: RETRY_DELAY_SECONDS })
  }
}

export async function handleScheduled(env: Env): Promise<void> {
  const traceId = crypto.randomUUID()
  const deps = createDeps(env)
  const count = await reconcileReviews(deps, traceId)
  console.info(JSON.stringify({ event: 'reconcile_reviews', traceId, reenqueued: count }))
  const rescored = await refreshStaleWork(deps)
  console.info(JSON.stringify({ event: 'refresh_stale_work', traceId, rescored }))
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (isApiPath(new URL(request.url).pathname)) return worker.fetch(request, env, ctx)
    return secureBrowserResponse(await env.ASSETS.fetch(request), env.OIDC_ISSUER, import.meta.env.DEV)
  },
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    await handleReviewBatch(batch, env)
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await handleScheduled(env)
  },
}
