import { createExecutionContext, createMessageBatch, env, getQueueResult } from 'cloudflare:test'
import { type ReferenceImport, referenceImportSql } from '@server/adapters/reference-sql'
import type { CefrRow } from '@server/domain/reference'
import type { Lemma } from '@server/domain/term'
import entry from '@server/worker'
import { issuedAgentSchema } from '@shared/agents'
import { createEntryResultSchema, managedEntryDetailSchema } from '@shared/catalog'
import {
  type FactDto,
  factPageSchema,
  factSchema,
  factWriteResultSchema,
  type Pos,
  type SenseId,
  type Verdict,
} from '@shared/facts'
import { workClaimSchema, workCompletionSchema } from '@shared/work'
import { importJWK, SignJWT } from 'jose'
import { expect, vi } from 'vitest'

export async function adminToken(sub = 'admin-1') {
  const key = await importJWK(JSON.parse(env.TEST_PRIVATE_JWK), 'ES256')
  return new SignJWT({ client_id: 'test-client' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test', typ: 'at+jwt' })
    .setSubject(sub)
    .setIssuer('https://issuer.test')
    .setAudience('https://issuer.test/oauth2/userinfo')
    .setExpirationTime('5m')
    .sign(key)
}

/** Bindings a test swaps for fakes, as the composition root reads them from the env. */
type Bindings = Partial<Pick<typeof env, 'READ_RATE_LIMITER'>>
type CallInit = RequestInit & { token?: string; json?: unknown; bindings?: Bindings }

let clients = 0
/** A client address no other request uses, so the read limit never couples tests. */
const freshClient = () => {
  clients += 1
  return `198.18.${Math.floor(clients / 256) % 256}.${clients % 256}`
}

/** The Worker's raw response, for tests that read headers or the exact body. */
export async function request(path: string, init: CallInit = {}) {
  const { token, json, bindings, ...rest } = init
  const headers = new Headers(rest.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (json !== undefined) headers.set('content-type', 'application/json')
  if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', freshClient())
  const body = json === undefined ? rest.body : JSON.stringify(json)
  return entry.fetch(
    new Request(`http://app.test${path}`, { ...rest, headers, body }),
    { ...env, ...bindings },
    createExecutionContext(),
  )
}

export async function call(path: string, init: CallInit = {}) {
  const response = await request(path, init)
  return { status: response.status, body: (response.status === 204 ? null : await response.json()) as unknown }
}

/** A producer agent's key, or a curator agent's with `curator`. */
export async function issueAgentKey(name = 'Test agent', curator = false): Promise<string> {
  const { status, body } = await call('/manage/v1/agents', {
    method: 'POST',
    token: await adminToken(),
    json: { name, curator },
  })
  if (status !== 201) throw new Error(`Could not issue an agent key: ${status}`)
  return issuedAgentSchema.parse(body).key
}

export const DECISIONS_URL = 'https://decisions.test/v1/decisions'
export const JEV_URL = 'https://models.test/v1/systemone'
export const LLM_URL = 'https://models.test/v1/chat/completions'

interface ReviewerAnswers {
  /** Every Jev answer. */
  jev?: number
  /** Every luna (Decisions API) answer. */
  luna?: number
  /** The LLM's verdict. */
  verdict?: Verdict
}

/**
 * Stubs the reviewers: Jev answers every question with `jev`, luna with `luna`, and the LLM
 * answers `verdict`. The defaults settle every decision-model pass.
 */
export function stubReviewers({ jev = 0.93, luna = 0.93, verdict = 'pass' }: ReviewerAnswers = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const body = (await request.json()) as {
      questions?: Record<string, unknown> | Array<{ name: string }>
    }
    if (request.url === JEV_URL) {
      const keys = Object.keys(body.questions ?? {})
      return Response.json({
        model: 'jev-test',
        answers: Object.fromEntries(keys.map((key) => [key, { type: 'noul', noul: jev }])),
      })
    }
    if (request.url === DECISIONS_URL) {
      const names = (body.questions as Array<{ name: string }>).map((question) => question.name)
      return Response.json({
        model: 'luna-test',
        answers: names.map((name) => ({ type: 'predicate', name, probability: luna })),
      })
    }
    if (request.url === LLM_URL) {
      const content = JSON.stringify({ verdict, confidence: 0.88, reason: 'Fine.' })
      return Response.json({ model: 'llm-test', choices: [{ message: { content } }] })
    }
    throw new Error(`Unexpected fetch to ${request.url}`)
  })
}

/** The URLs a stubbed fetch was called with, in order. */
export const calledUrls = (spy: ReturnType<typeof stubReviewers>) =>
  spy.mock.calls.map(([input]) => new Request(input as RequestInfo).url)

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

/** Stubs the reviewers with `answers`, reviews every pending fact, and restores fetch. */
export async function reviewPending(answers: ReviewerAnswers = {}) {
  const spy = stubReviewers(answers)
  try {
    return await deliverPendingReviews()
  } finally {
    spy.mockRestore()
  }
}

/** Admits a lemma as a live headword of `batch`, as a curator does; returns its entry id. */
export async function admit(lemma: string, batch = 1) {
  const { status, body } = await call('/manage/v1/entries', {
    method: 'POST',
    token: await adminToken(),
    json: { lemma, batch },
  })
  if (status !== 201 && status !== 200) throw new Error(`Could not admit ${lemma}: ${status} ${JSON.stringify(body)}`)
  return createEntryResultSchema.parse(body).entry.id
}

/** POST /manage/v1/facts as `token`. */
export function submit(
  token: string,
  kind: string,
  subjectId: string,
  payload: unknown,
  extra: { supersedes_id?: string; curation?: { reason: string } } = {},
) {
  return call('/manage/v1/facts', { method: 'POST', token, json: { kind, subject_id: subjectId, payload, ...extra } })
}

/** Submits a fact that must be accepted (201 or 200) and returns it. */
export async function submitOk(
  token: string,
  kind: string,
  subjectId: string,
  payload: unknown,
  extra: { supersedes_id?: string; curation?: { reason: string } } = {},
): Promise<FactDto> {
  const { status, body } = await submit(token, kind, subjectId, payload, extra)
  if (status !== 201 && status !== 200) throw new Error(`Submitting ${kind} failed: ${status} ${JSON.stringify(body)}`)
  return factWriteResultSchema.parse(body).fact
}

/** Publishes a fact at once with a curator review, without the reviewer chain. */
export async function curated(kind: string, subjectId: string, payload: unknown, supersedesId?: string) {
  return submitOk(await adminToken(), kind, subjectId, payload, {
    curation: { reason: 'Test setup.' },
    ...(supersedesId ? { supersedes_id: supersedesId } : {}),
  })
}

export interface SenseSpec {
  pos: Pos
  gloss: string
  rank?: 'common' | 'extra'
  register?: string
  region?: string
  id?: string
}

const inventoryPayload = (senses: readonly SenseSpec[]) => ({
  senses: senses.map(({ rank = 'common', ...sense }) => ({ ...sense, rank })),
})

/** The ids of an inventory fact's senses, in its order. */
export const senseIds = (fact: FactDto): SenseId[] => {
  if (fact.kind !== 'senses') throw new Error(`Fact ${fact.id} is ${fact.kind}, not an inventory.`)
  return fact.payload.senses.map((sense) => sense.id)
}

/** Publishes the entry's sense inventory with a curator review; returns the inventory and its sense ids. */
export async function publishInventory(entryId: string, senses: readonly SenseSpec[], supersedesId?: string) {
  const fact = await curated('senses', entryId, inventoryPayload(senses), supersedesId)
  return { fact, senses: senseIds(fact) }
}

/** Submits the entry's sense inventory for review as `token`; returns the pending inventory. */
export async function submitInventory(token: string, entryId: string, senses: readonly SenseSpec[]) {
  return submitOk(token, 'senses', entryId, inventoryPayload(senses))
}

/** A live headword with a published inventory: its entry id and its sense ids in order. */
export async function headword(lemma: string, senses: readonly SenseSpec[], batch = 1) {
  const entryId = await admit(lemma, batch)
  const inventory = await publishInventory(entryId, senses)
  return { entryId, inventory: inventory.fact, senses: inventory.senses }
}

/** The entry's management view. */
export async function managed(lemma: string) {
  const { status, body } = await call(`/manage/v1/entries/${encodeURIComponent(lemma)}`, { token: await adminToken() })
  expect(status).toBe(200)
  return managedEntryDetailSchema.parse(body)
}

/** One fact read through the management API. */
export async function readFact(id: string) {
  const { body } = await call(`/manage/v1/facts/${id}`, { token: await adminToken() })
  return factSchema.parse(body)
}

/** Claims work as `token`; null on 204. */
export async function claim(token: string, input: { types?: string[]; limit?: number; lease_seconds?: number } = {}) {
  const { status, body } = await call('/manage/v1/work/claim', { method: 'POST', token, json: input })
  if (status === 204) return null
  if (status !== 200) throw new Error(`Claim failed: ${status} ${JSON.stringify(body)}`)
  return workClaimSchema.parse(body)
}

/** Completes a lease as `token`, which must succeed. */
export async function complete(
  token: string,
  leaseId: string,
  items: Array<{ id: string; note?: string; found_none?: boolean; blocked_on?: string[] }>,
) {
  const { status, body } = await call(`/manage/v1/work/${leaseId}/complete`, { method: 'POST', token, json: { items } })
  if (status !== 200) throw new Error(`Complete failed: ${status} ${JSON.stringify(body)}`)
  return workCompletionSchema.parse(body)
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

/** Reference rows for the test: each of `levels` listed as a noun, each of `verbs` as a verb. */
export function importLearnerData(data: {
  zipf?: Record<string, number>
  levels?: Record<string, CefrRow['level']>
  verbs?: Record<string, CefrRow['level']>
}) {
  const listed = (levels: Record<string, CefrRow['level']> | undefined, pos: CefrRow['pos']) =>
    Object.entries(levels ?? {}).map(([lemma, level]) => ({ lemma: lemma as Lemma, pos, level, sourceId: 'cefr' }))
  return importReference({
    sources: [testSource('freq'), testSource('cefr')],
    frequency: {
      sourceId: 'freq',
      rows: Object.entries(data.zipf ?? {}).map(([word, zipf], index) => ({ word, zipf, rank: index + 1 })),
    },
    cefr: [...listed(data.levels, 'noun'), ...listed(data.verbs, 'verb')],
  })
}
