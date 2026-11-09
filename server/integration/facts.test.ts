import { createEntryResultSchema, publicEntrySchema, statsSchema } from '@shared/catalog'
import { factSchema, factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminToken, call, deliverPendingReviews, issueAgentKey, stubReviewers } from './helpers'

describe('fact review flow', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reviews a submitted fact through the queue consumer and publishes it [spec: facts/review-flow]', async () => {
    const token = await issueAgentKey()
    const created = await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'lake' } })
    expect(created.status).toBe(201)
    const { fact } = createEntryResultSchema.parse(created.body)
    expect(fact.status).toBe('pending')
    expect((await call('/v1/entries/lake')).status).toBe(404)

    const gateway = stubReviewers()
    const result = await deliverPendingReviews()
    expect(result.explicitAcks).toEqual(['m0'])
    expect(gateway).toHaveBeenCalledOnce()

    const reviewed = factSchema.parse((await call(`/manage/v1/facts/${fact.id}`, { token })).body)
    expect(reviewed).toMatchObject({
      status: 'published',
      review: { reviewer: 'jev', verdict: 'pass', confidence: 0.93 },
    })
    const entry = publicEntrySchema.parse((await call('/v1/entries/lake')).body)
    expect(entry.fact).toEqual({ id: fact.id, confidence: 0.93, verdict: 'pass' })

    const again = await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'lake' } })
    expect(again.status).toBe(200)
  })

  it('retries the message and keeps the fact pending when the gateway is down [spec: facts/transport-retry-api]', async () => {
    const token = await issueAgentKey()
    const { fact } = createEntryResultSchema.parse(
      (await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'pond' } })).body,
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }))
    const result = await deliverPendingReviews()
    expect(result.retryMessages).toEqual([expect.objectContaining({ msgId: 'm0' })])
    expect(result.explicitAcks).toEqual([])
    expect(factSchema.parse((await call(`/manage/v1/facts/${fact.id}`, { token })).body).status).toBe('pending')
  })

  it('reviews the facts of one batch concurrently [spec: facts/review-batch-concurrent]', async () => {
    const token = await issueAgentKey()
    const lemmas = ['brook', 'creek', 'delta', 'estuary', 'fjord']
    for (const lemma of lemmas) await call('/manage/v1/entries', { method: 'POST', token, json: { lemma } })

    let inFlight = 0
    let peak = 0
    let release: () => void = () => {}
    const allStarted = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { questions } = (await new Request(input, init).json()) as { questions: Record<string, unknown> }
      inFlight += 1
      peak = Math.max(peak, inFlight)
      if (inFlight === lemmas.length) release()
      await allStarted
      inFlight -= 1
      const answers = Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: 0.93 }]))
      return Response.json({ model: 'jev-test', answers })
    })

    const result = await deliverPendingReviews()
    expect(peak).toBe(lemmas.length)
    expect(result.explicitAcks).toHaveLength(lemmas.length)
    for (const lemma of lemmas) expect((await call(`/v1/entries/${lemma}`)).status).toBe(200)
  })

  it('dedupes resubmissions and reports invalid references [spec: facts/submit-api]', async () => {
    const token = await issueAgentKey()
    const { entry } = createEntryResultSchema.parse(
      (await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'river' } })).body,
    )
    const form = { kind: 'form', subject_id: entry.id, payload: { form: 'rivers', type: 'plural' } }
    const first = await call('/manage/v1/facts', { method: 'POST', token, json: form })
    const second = await call('/manage/v1/facts', { method: 'POST', token, json: form })
    expect([first.status, second.status]).toEqual([201, 200])
    expect(factWriteResultSchema.parse(second.body).fact.id).toBe(factWriteResultSchema.parse(first.body).fact.id)

    const wrongSubject = await call('/manage/v1/facts', {
      method: 'POST',
      token,
      json: { kind: 'example', subject_id: entry.id, payload: { text: 'x' } },
    })
    expect(wrongSubject.status).toBe(422)
    expect(apiErrorSchema.parse(wrongSubject.body).error.code).toBe('invalid_reference')

    const invalid = await call('/manage/v1/facts', {
      method: 'POST',
      token,
      json: { kind: 'form', subject_id: entry.id, payload: {} },
    })
    expect(invalid.status).toBe(400)
  })

  it('lets an agent retract its own fact, reserves re-review for admins, and counts facts [spec: facts/manage-api]', async () => {
    const token = await issueAgentKey()
    const { fact } = createEntryResultSchema.parse(
      (await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'brook' } })).body,
    )
    expect((await call(`/manage/v1/facts/${fact.id}/rereview`, { method: 'POST', token })).status).toBe(403)
    const retracted = await call(`/manage/v1/facts/${fact.id}/retract`, { method: 'POST', token })
    expect(factSchema.parse(retracted.body).status).toBe('retracted')
    const rereview = await call(`/manage/v1/facts/${fact.id}/rereview`, { method: 'POST', token: await adminToken() })
    expect(rereview.status).toBe(409)

    const stats = statsSchema.parse((await call('/manage/v1/stats', { token })).body)
    expect(stats).toEqual({ facts: [{ kind: 'entry', status: 'retracted', count: 1 }], open_feedback: 0 })
  })
})
