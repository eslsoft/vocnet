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
import { publicReadBoundary } from './http/public-reads'
import { classifyWork } from './usecases/classify'
import { ReviewerTransportError } from './usecases/ports'
import { rebuildStalePublicViews } from './usecases/public-view'
import { type ReviewStage, reconcilePhraseLists, reconcileReviews, reviewFact } from './usecases/review'
import { purgeExpiredLeases } from './usecases/work'
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
  .use('/v1/*', publicReadBoundary)
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
  const batchId = crypto.randomUUID()
  const started = Date.now()
  // Start and end lines bracket the batch: a batch that starts and never ends held the queue.
  console.info(JSON.stringify({ event: 'review_batch', batchId, phase: 'start', size: batch.messages.length }))
  await Promise.all(batch.messages.map((message) => handleReviewMessage(deps, message, batchId)))
  console.info(JSON.stringify({ event: 'review_batch', batchId, phase: 'end', durationMs: Date.now() - started }))
}

async function handleReviewMessage(
  deps: ReturnType<typeof createDeps>,
  message: Message<unknown>,
  batchId: string,
): Promise<void> {
  const parsed = reviewMessageSchema.safeParse(message.body)
  if (!parsed.success) {
    console.error(JSON.stringify({ event: 'review_job_invalid', messageId: message.id, issues: parsed.error.issues }))
    message.ack()
    return
  }
  const job: ReviewMessage = parsed.data
  const log = { event: 'review_job', factId: job.fact_id, traceId: job.trace_id, attempt: message.attempts }
  const started = Date.now()
  // Each step's end, so a review that never finishes names the step it stopped after.
  const onStage = (stage: ReviewStage) =>
    console.info(
      JSON.stringify({ event: 'review_stage', batchId, factId: job.fact_id, stage, ms: Date.now() - started }),
    )
  try {
    const outcome = await reviewFact(deps, job.fact_id, job.trace_id, onStage)
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

/** Views a cron run rebuilds: reads rebuild what they find stale, so the sweep only drains leftovers. */
const STALE_VIEW_BATCH = 100
/**
 * How long one scheduled run classifies: past this it lets the next run carry on, so a run stays
 * inside the platform's cron limit and the local loop's request timeout.
 */
const CLASSIFY_BUDGET_MS = 8 * 60 * 1000

export async function handleScheduled(env: Env): Promise<void> {
  const traceId = crypto.randomUUID()
  const deps = createDeps(env)
  // Each step logs how long it took, so a slow sweep shows which step holds the database.
  const timed = async <T>(event: string, step: () => Promise<T>, fields: (result: T) => object) => {
    const started = Date.now()
    const result = await step()
    console.info(JSON.stringify({ event, traceId, durationMs: Date.now() - started, ...fields(result) }))
  }
  await timed(
    'reconcile_reviews',
    () => reconcileReviews(deps, traceId),
    (reenqueued) => ({ reenqueued }),
  )
  await timed(
    'refresh_stale_work',
    () => refreshStaleWork(deps),
    (rescored) => ({ rescored }),
  )
  await timed(
    'reconcile_phrase_lists',
    () => reconcilePhraseLists(deps),
    (admitted) => ({ admitted }),
  )
  await timed(
    'purge_expired_leases',
    () => purgeExpiredLeases(deps),
    (purged) => ({ purged }),
  )
  await timed(
    'rebuild_public_views',
    () => rebuildStalePublicViews(deps, STALE_VIEW_BATCH),
    (views) => views,
  )
  await timed(
    'classify_work',
    () => classifyWork(deps, traceId, CLASSIFY_BUDGET_MS),
    (tally) => tally,
  )
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
