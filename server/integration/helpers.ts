import { createExecutionContext, createMessageBatch, env, getQueueResult } from 'cloudflare:test'
import { type ReferenceImport, referenceImportSql } from '@server/adapters/reference-sql'
import type { CefrRow } from '@server/domain/reference'
import type { Lemma } from '@server/domain/term'
import entry from '@server/worker'
import { issuedAgentSchema } from '@shared/agents'
import { factPageSchema, type Verdict } from '@shared/facts'
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

type CallInit = RequestInit & { token?: string; json?: unknown }

/** The Worker's raw response, for tests that read headers or the exact body. */
export async function request(path: string, init: CallInit = {}) {
  const headers = new Headers(init.headers)
  if (init.token) headers.set('authorization', `Bearer ${init.token}`)
  if (init.json !== undefined) headers.set('content-type', 'application/json')
  const body = init.json === undefined ? init.body : JSON.stringify(init.json)
  return entry.fetch(new Request(`http://app.test${path}`, { ...init, headers, body }), env, createExecutionContext())
}

export async function call(path: string, init: CallInit = {}) {
  const response = await request(path, init)
  return { status: response.status, body: (response.status === 204 ? null : await response.json()) as unknown }
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

/** Stubs the model gateway: Jev answers every question with `noul`; the LLM answers `verdict`. */
export function stubReviewers(noul = 0.93, verdict: Verdict = 'pass') {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const body = (await request.json()) as { questions?: Record<string, unknown> }
    if (request.url === 'https://models.test/v1/systemone') {
      const answers = Object.fromEntries(Object.keys(body.questions ?? {}).map((key) => [key, { type: 'noul', noul }]))
      return Response.json({ model: 'jev-test', answers })
    }
    if (request.url === 'https://models.test/v1/chat/completions') {
      const content = JSON.stringify({ verdict, confidence: 0.88, reason: 'Fine.' })
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

/** Applies one reference import as `wrangler d1 execute` applies the generated SQL. */
export async function importReference(data: ReferenceImport) {
  await env.DB.batch(referenceImportSql(data).map((statement) => env.DB.prepare(statement)))
}

const testSource = (id: string) => ({
  id,
  name: id,
  version: '1.0',
  license: 'CC BY-SA 4.0',
  license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  changes: 'Filtered by Vocnet.',
  attribution: id,
  url: `https://example.test/${id}`,
  retrieved_at: '2026-11-09',
})

/** Imports frequencies by frequency key and CEFR levels by exact lemma, each lemma's level as a noun. */
export function importLearnerData(data: { zipf?: Record<string, number>; levels?: Record<string, CefrRow['level']> }) {
  return importReference({
    sources: [testSource('freq'), testSource('cefr')],
    frequency: {
      sourceId: 'freq',
      rows: Object.entries(data.zipf ?? {}).map(([word, zipf], index) => ({ word, zipf, rank: index + 1 })),
    },
    cefr: Object.entries(data.levels ?? {}).map(([lemma, level]) => ({
      lemma: lemma as Lemma,
      pos: 'noun' as const,
      level,
      sourceId: 'cefr',
    })),
  })
}
