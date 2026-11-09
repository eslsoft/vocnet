import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from './context'

const REQUEST_ID = /^[a-zA-Z0-9._:-]{1,128}$/

function incomingId(value: string | undefined): string | undefined {
  return value && REQUEST_ID.test(value) ? value : undefined
}

export const requestBoundary: MiddlewareHandler<AppEnv> = async (c, next) => {
  const startedAt = performance.now()
  const requestId = incomingId(c.req.header('x-request-id')) ?? crypto.randomUUID()
  const traceId = incomingId(c.req.header('x-trace-id')) ?? requestId
  c.set('requestId', requestId)
  c.set('traceId', traceId)

  await next()

  c.header('x-request-id', requestId)
  c.header('x-trace-id', traceId)
  const error = c.get('unexpectedError')
  const entry = {
    event: 'http_request',
    requestId,
    traceId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    authMethod: c.get('authMethod') ?? null,
    userAgent: c.req.header('user-agent') ?? null,
    contentType: c.req.header('content-type') ?? null,
    error: error ? { name: error.name, message: error.message, stack: error.stack } : null,
  }
  const serialized = JSON.stringify(entry)
  if (error) console.error(serialized)
  else console.info(serialized)
}

export const auditBoundary: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) || c.res.status >= 400) return

  console.info(
    JSON.stringify({
      event: 'audit',
      requestId: c.get('requestId'),
      traceId: c.get('traceId'),
      actorId: c.get('user')?.sub ?? null,
      action: c.req.method.toLowerCase(),
      resource: c.req.path,
      status: c.res.status,
    }),
  )
}
