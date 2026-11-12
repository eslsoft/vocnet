import { env } from 'cloudflare:test'
import entry from '@server/worker'
import { publicEntrySchema } from '@shared/catalog'
import type { SenseId } from '@shared/facts'
import { factSchema, factWriteResultSchema } from '@shared/facts'
import { consoleStatsSchema } from '@shared/monitor'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adminToken,
  call,
  calledUrls,
  DECISIONS_URL,
  deliverPendingReviews,
  deliverReviews,
  headword,
  issueAgentKey,
  JEV_URL,
  LLM_URL,
  readFact,
  reviewPending,
  stubReviewers,
  submit,
  submitOk,
} from './helpers'

const errorOf = (body: unknown) => apiErrorSchema.parse(body).error

describe('fact review flow', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reviews a submitted fact through the queue consumer and publishes it [spec: facts/review-flow]', async () => {
    const { senses } = await headword('lake', [{ pos: 'noun', gloss: 'A large area of water surrounded by land.' }])
    const token = await issueAgentKey()
    const example = await submitOk(token, 'example', senses[0] as string, { text: 'We swam in the lake.' })
    expect(example.status).toBe('pending')
    const before = publicEntrySchema.parse((await call('/v1/entries/lake')).body)
    expect(before.meanings[0]?.senses[0]?.examples).toEqual([])

    const gateway = stubReviewers()
    const result = await deliverPendingReviews()
    expect(result.explicitAcks).toEqual(['m0'])
    expect(calledUrls(gateway)).toEqual([LLM_URL])

    expect(await readFact(example.id)).toMatchObject({
      status: 'published',
      review: { reviewer: 'llm', verdict: 'pass', confidence: 0.88 },
    })
    const after = publicEntrySchema.parse((await call('/v1/entries/lake?include=review')).body)
    expect(after.meanings[0]?.senses[0]?.examples).toEqual([
      { text: 'We swam in the lake.', review: { fact_id: example.id, confidence: 0.88, verdict: 'pass' } },
    ])
  })

  it('settles a pass with the decision models and leaves the rest to the LLM [spec: facts/second-opinion-api]', async () => {
    const { senses } = await headword('bank', [
      { pos: 'noun', gloss: 'An organization that keeps money for people.' },
      { pos: 'noun', gloss: 'The land along the side of a river.' },
    ])
    const token = await issueAgentKey()
    const [money, river] = senses as [SenseId, SenseId]
    const unsettled = await submitOk(token, 'translation', money, { language: 'zh', of: 'sense', text: '银行' })
    const low = stubReviewers({ jev: 0.2, luna: 0.3, verdict: 'pass' })
    await deliverReviews([unsettled.id])
    expect(calledUrls(low).sort()).toEqual([DECISIONS_URL, JEV_URL, LLM_URL].sort())
    low.mockRestore()
    const decided = await readFact(unsettled.id)
    expect(decided).toMatchObject({
      status: 'published',
      review: { reviewer: 'jev+luna+llm', model: 'jev-test+luna-test+llm-test', verdict: 'pass', confidence: 0.88 },
    })
    expect(decided.review?.detail).toMatchObject({
      opinions: [
        { reviewer: 'jev', verdict: 'fail' },
        { reviewer: 'luna', verdict: 'fail' },
        { reviewer: 'llm', verdict: 'pass' },
      ],
    })

    const settled = await submitOk(token, 'translation', river, { language: 'zh', of: 'sense', text: '河岸' })
    const lunaOnly = stubReviewers({ jev: 0.2, luna: 0.95, verdict: 'fail' })
    await deliverReviews([settled.id])
    expect(calledUrls(lunaOnly)).not.toContain(LLM_URL)
    expect(await readFact(settled.id)).toMatchObject({
      status: 'published',
      review: { reviewer: 'jev+luna', verdict: 'pass', confidence: 0.95 },
    })
  })

  it('retries the message and keeps the fact pending when a reviewer is down [spec: facts/transport-retry-api]', async () => {
    const { senses } = await headword('pond', [{ pos: 'noun', gloss: 'A small area of still water.' }])
    const token = await issueAgentKey()
    const example = await submitOk(token, 'example', senses[0] as string, { text: 'Ducks swim on the pond.' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }))
    const down = await deliverReviews([example.id])
    expect(down.retryMessages).toEqual([expect.objectContaining({ msgId: 'm0' })])
    expect(down.explicitAcks).toEqual([])
    expect((await readFact(example.id)).status).toBe('pending')
    vi.restoreAllMocks()

    const translation = await submitOk(token, 'translation', senses[0] as string, {
      language: 'zh',
      of: 'sense',
      text: '池塘',
    })
    const reviewers = stubReviewers()
    const decisions = reviewers.getMockImplementation()
    reviewers.mockImplementation(async (input, init) => {
      if (new Request(input as RequestInfo).url === DECISIONS_URL) return new Response('unavailable', { status: 503 })
      return (decisions as typeof fetch)(input as RequestInfo, init)
    })
    const lunaDown = await deliverReviews([translation.id])
    expect(lunaDown.retryMessages).toEqual([expect.objectContaining({ msgId: 'm0' })])
    expect((await readFact(translation.id)).status).toBe('pending')
  })

  it('reviews the facts of one batch concurrently [spec: facts/review-batch-concurrent]', async () => {
    const { senses } = await headword('river', [{ pos: 'noun', gloss: 'A natural stream of water.' }])
    const token = await issueAgentKey()
    const texts = [
      'The river is wide.',
      'We crossed the river.',
      'The river froze.',
      'A river runs here.',
      'Fish live in the river.',
    ]
    for (const text of texts) await submitOk(token, 'example', senses[0] as string, { text })

    let inFlight = 0
    let peak = 0
    let release: () => void = () => {}
    const allStarted = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      if (inFlight === texts.length) release()
      await allStarted
      inFlight -= 1
      const content = JSON.stringify({ verdict: 'pass', confidence: 0.9, reason: 'Fine.' })
      return Response.json({ model: 'llm-test', choices: [{ message: { content } }] })
    })

    const result = await deliverPendingReviews()
    expect(peak).toBe(texts.length)
    expect(result.explicitAcks).toHaveLength(texts.length)
    const view = publicEntrySchema.parse((await call('/v1/entries/river')).body)
    expect(view.meanings[0]?.senses[0]?.examples).toHaveLength(texts.length)
  })

  it('dedupes resubmissions and reports invalid references [spec: facts/submit-api]', async () => {
    const { entryId } = await headword('stream', [{ pos: 'noun', gloss: 'A small narrow river.' }])
    const token = await issueAgentKey()
    const form = { form: 'streams', type: 'plural' }
    const first = await submit(token, 'form', entryId, form)
    const second = await submit(token, 'form', entryId, form)
    expect([first.status, second.status]).toEqual([201, 200])
    expect(factWriteResultSchema.parse(second.body).fact.id).toBe(factWriteResultSchema.parse(first.body).fact.id)

    const wrongSubject = await submit(token, 'example', entryId, { text: 'The stream is cold.' })
    expect([wrongSubject.status, errorOf(wrongSubject.body).code]).toEqual([422, 'invalid_reference'])

    const invalid = await submit(token, 'form', entryId, {})
    expect([invalid.status, errorOf(invalid.body).code]).toEqual([400, 'invalid_request'])
  })

  it('enforces write rules: one fact per symmetric pair, relations across entries, gloss and ipa format, served translation language [spec: facts/write-rules-api]', async () => {
    const east = await headword('east', [{ pos: 'noun', gloss: 'The direction toward the sunrise.' }])
    const west = await headword('west', [
      { pos: 'noun', gloss: 'The direction toward the sunset.' },
      { pos: 'noun', gloss: 'The western part of a region.' },
    ])
    const token = await issueAgentKey()
    const [eastSense] = east.senses as [SenseId]
    const [westSense, westward] = west.senses as [SenseId, SenseId]
    const antonym = (from: string, to: string) =>
      submit(token, 'relation', from, { type: 'antonym', target_sense_id: to })
    const first = await antonym(eastSense, westSense)
    const mirrored = await antonym(westSense, eastSense)
    expect([first.status, mirrored.status]).toEqual([201, 200])
    const stored = factWriteResultSchema.parse(first.body).fact
    expect(factWriteResultSchema.parse(mirrored.body).fact.id).toBe(stored.id)
    expect(stored.subject_id < (stored.object_id ?? '')).toBe(true)

    const sameEntry = await antonym(westSense, westward)
    expect([sameEntry.status, errorOf(sameEntry.body).code]).toEqual([422, 'invalid_reference'])

    const fresh = await headword('north', [{ pos: 'noun', gloss: 'The direction toward the pole.' }])
    const badGloss = await submit(token, 'senses', fresh.entryId, {
      senses: [{ pos: 'noun', gloss: 'toward the north, as in "go north"', rank: 'common' }],
    })
    expect(badGloss.status).toBe(400)
    expect(errorOf(badGloss.body)).toMatchObject({
      code: 'invalid_request',
      message: expect.stringMatching(/capital letter.*period.*no examples/),
    })
    const badIpa = await submit(token, 'pronunciation', east.entryId, { ipa: 'iːst, ɪst', accent: 'us' })
    expect(badIpa.status).toBe(400)
    expect(errorOf(badIpa.body).message).toContain('exactly one transcription')
    const traditional = await submit(token, 'translation', eastSense, {
      language: 'zh-Hant',
      of: 'sense',
      text: '東方',
    })
    expect(traditional.status).toBe(400)
    expect(errorOf(traditional.body).message).toContain('served language: zh')
  })

  it('refuses resubmitted rejected content without a new review [spec: facts/rejected-before-api]', async () => {
    const { entryId } = await headword('water', [{ pos: 'noun', gloss: 'The clear liquid that falls as rain.' }])
    const token = await issueAgentKey()
    const rejected = await submitOk(token, 'syllables', entryId, { syllables: ['wa', 'ter'] })
    await reviewPending({ luna: 0.1, verdict: 'fail' })
    expect((await readFact(rejected.id)).status).toBe('rejected')

    const gateway = stubReviewers()
    const again = await submit(token, 'syllables', entryId, { syllables: ['wa', 'ter'] })
    expect(again.status).toBe(409)
    expect(errorOf(again.body)).toMatchObject({
      code: 'rejected_before',
      message: expect.stringContaining(rejected.id),
    })
    expect(errorOf(again.body).message).toContain('Fine.')
    expect(gateway).not.toHaveBeenCalled()
    expect((await submit(token, 'syllables', entryId, { syllables: ['wat', 'er'] })).status).toBe(201)
  })

  it('re-enqueues a fact stuck pending from the scheduled run [spec: facts/reconcile-api]', async () => {
    const { senses } = await headword('brook', [{ pos: 'noun', gloss: 'A small stream.' }])
    const token = await issueAgentKey()
    const stuck = await submitOk(token, 'example', senses[0] as string, { text: 'A brook ran past the farm.' })
    const fresh = await submitOk(token, 'example', senses[0] as string, { text: 'The brook was shallow.' })
    await env.DB.prepare("update facts set updated_at = '2026-01-01T00:00:00.000Z' where id = ?").bind(stuck.id).run()

    const sent = vi.spyOn(env.REVIEW_QUEUE, 'sendBatch')
    await entry.scheduled({} as ScheduledController, env)
    const ids = sent.mock.calls.flatMap(([messages]) =>
      [...messages].map((message) => (message.body as { fact_id: string }).fact_id),
    )
    expect(ids).toContain(stuck.id)
    expect(ids).not.toContain(fresh.id)
  })

  it('lets an agent retract its own fact, reserves re-review for admins, and counts facts [spec: facts/manage-api]', async () => {
    const { senses } = await headword('creek', [{ pos: 'noun', gloss: 'A narrow stream.' }])
    const token = await issueAgentKey()
    const fact = await submitOk(token, 'example', senses[0] as string, { text: 'The creek dried up.' })
    expect((await call(`/manage/v1/facts/${fact.id}/rereview`, { method: 'POST', token })).status).toBe(403)
    const retracted = await call(`/manage/v1/facts/${fact.id}/retract`, { method: 'POST', token })
    expect(factSchema.parse(retracted.body).status).toBe('retracted')
    const rereview = await call(`/manage/v1/facts/${fact.id}/rereview`, { method: 'POST', token: await adminToken() })
    expect(rereview.status).toBe(409)

    const stats = consoleStatsSchema.parse((await call('/manage/v1/stats', { token })).body)
    expect(stats.facts).toEqual(
      expect.arrayContaining([
        { kind: 'example', status: 'retracted', count: 1 },
        { kind: 'senses', status: 'published', count: 1 },
      ]),
    )
    expect(stats.tickets).toEqual({ open: 0, resolved: 0, dismissed: 0 })
  })
})
