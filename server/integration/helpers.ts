import { createExecutionContext, createMessageBatch, env, getQueueResult } from 'cloudflare:test'
import entry from '@server/worker'
import { issuedAgentSchema } from '@shared/agents'
import { factPageSchema } from '@shared/facts'
import { importJWK, SignJWT } from 'jose'
import { vi } from 'vitest'

export async function adminToken(sub = 'admin-1') {
  const key = await importJWK(JSON.parse(env.TEST_PRIVATE_JWK), 'ES256')
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: 'test' })
    .setSubject(sub)
    .setIssuer('https://issuer.test')
    .setAudience('test-client')
    .setExpirationTime('5m')
    .sign(key)
}

export async function call(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers = new Headers(init.headers)
  if (init.token) headers.set('authorization', `Bearer ${init.token}`)
  if (init.json !== undefined) headers.set('content-type', 'application/json')
  const body = init.json === undefined ? init.body : JSON.stringify(init.json)
  const response = await entry.fetch(
    new Request(`http://app.test${path}`, { ...init, headers, body }),
    env,
    createExecutionContext(),
  )
  return { status: response.status, body: (await response.json()) as unknown }
}

export async function issueAgentKey(name = 'Test agent'): Promise<string> {
  const { status, body } = await call('/manage/v1/agents', {
    method: 'POST',
    token: await adminToken(),
    json: { name },
  })
  if (status !== 201) throw new Error(`Could not issue an agent key: ${status}`)
  return issuedAgentSchema.parse(body).key
}

/** Stubs the model gateway: Jev answers every question with `noul`; the LLM passes. */
export function stubReviewers(noul = 0.93) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const body = (await request.json()) as { questions?: Record<string, unknown> }
    if (request.url === 'https://models.test/v1/systemone') {
      const answers = Object.fromEntries(Object.keys(body.questions ?? {}).map((key) => [key, { type: 'noul', noul }]))
      return Response.json({ model: 'jev-test', answers })
    }
    if (request.url === 'https://models.test/v1/chat/completions') {
      const content = JSON.stringify({ verdict: 'pass', confidence: 0.88, reason: 'Fine.' })
      return Response.json({ model: 'llm-test', choices: [{ message: { content } }] })
    }
    throw new Error(`Unexpected fetch to ${request.url}`)
  })
}

/** Delivers one review job per fact id through the Worker's real queue handler. */
export async function deliverReviews(ids: string[]) {
  const batch = createMessageBatch(
    'vocnet-reviews',
    ids.map((id, index) => ({
      id: `m${index}`,
      timestamp: new Date(),
      attempts: 1,
      body: { fact_id: id, trace_id: 't' },
    })),
  )
  const ctx = createExecutionContext()
  await entry.queue(batch, env)
  return getQueueResult(batch, ctx)
}

/** Delivers review jobs for every pending fact through the Worker's real queue handler. */
export async function deliverPendingReviews() {
  const { body } = await call('/manage/v1/facts?status=pending&limit=100', { token: await adminToken() })
  return deliverReviews(factPageSchema.parse(body).items.map((fact) => fact.id))
}
