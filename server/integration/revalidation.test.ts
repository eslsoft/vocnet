import { env } from 'cloudflare:test'
import { createEntryResultSchema, createSenseResultSchema, publicEntrySchema } from '@shared/catalog'
import { type FactDto, factSchema, factWriteResultSchema } from '@shared/facts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminToken, call, deliverPendingReviews, deliverReviews, issueAgentKey, stubReviewers } from './helpers'

async function marks(ids: string[]) {
  const read = env.DB.prepare('SELECT revalidate_since AS mark FROM facts WHERE id = ?')
  return Promise.all(ids.map(async (id) => (await read.bind(id).first<{ mark: string | null }>())?.mark))
}

async function factOf(id: string): Promise<FactDto> {
  return factSchema.parse((await call(`/manage/v1/facts/${id}`, { token: await adminToken() })).body)
}

/** A river sense with an example and an incoming relation, all published, then its gloss corrected. */
async function correctedRiverBank(newGloss: string) {
  const token = await issueAgentKey()
  const post = async (path: string, json: unknown) => (await call(path, { method: 'POST', token, json })).body
  const bank = createEntryResultSchema.parse(await post('/manage/v1/entries', { lemma: 'bank' }))
  const shore = createEntryResultSchema.parse(await post('/manage/v1/entries', { lemma: 'shore' }))
  const river = createSenseResultSchema.parse(
    await post('/manage/v1/senses', { entry_id: bank.entry.id, pos: 'noun', gloss: 'land beside a river' }),
  )
  const coast = createSenseResultSchema.parse(
    await post('/manage/v1/senses', { entry_id: shore.entry.id, pos: 'noun', gloss: 'land along water' }),
  )
  const submit = async (json: unknown) => factWriteResultSchema.parse(await post('/manage/v1/facts', json)).fact
  const example = await submit({
    kind: 'example',
    subject_id: river.sense.id,
    payload: { text: 'We sat on the bank.' },
  })
  const incoming = await submit({
    kind: 'relation',
    subject_id: coast.sense.id,
    payload: { type: 'synonym', target_sense_id: river.sense.id },
  })
  const unrelated = await submit({ kind: 'example', subject_id: coast.sense.id, payload: { text: 'Waves hit it.' } })
  stubReviewers()
  await deliverPendingReviews()
  const correction = await submit({
    kind: 'sense',
    subject_id: river.sense.id,
    supersedes_id: river.fact.id,
    payload: { gloss: newGloss },
  })
  await deliverPendingReviews()
  vi.restoreAllMocks()
  return { token, correction, example, incoming, unrelated }
}

const llmVerdict = (verdict: 'pass' | 'fail') =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    if (request.url.endsWith('/v1/systemone')) {
      const { questions } = (await request.json()) as { questions: Record<string, unknown> }
      const answers = Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: 0.9 }]))
      return Response.json({ model: 'jev-test', answers })
    }
    const content = JSON.stringify({ verdict, confidence: 0.9, reason: 'Judged.' })
    return Response.json({ model: 'llm-test', choices: [{ message: { content } }] })
  })

describe('revalidation', () => {
  afterEach(() => vi.restoreAllMocks())

  it('re-reviews facts judged against a corrected gloss in place, keeping them public [spec: facts/revalidate-api]', async () => {
    const { example, incoming, unrelated } = await correctedRiverBank('the sloping land beside a river')
    const before = await factOf(unrelated.id)
    const entry = publicEntrySchema.parse((await call('/v1/entries/bank')).body)
    expect(entry.senses[0]?.examples.map((item) => item.id)).toEqual([example.id])
    expect(entry.senses[0]?.relations.map((item) => item.id)).toEqual([incoming.id])

    llmVerdict('pass')
    const result = await deliverReviews([example.id, incoming.id, unrelated.id, example.id])
    expect(result.explicitAcks).toEqual(['m0', 'm1', 'm2', 'm3'])

    for (const id of [example.id, incoming.id]) {
      const fact = await factOf(id)
      expect(fact.status).toBe('published')
      expect(JSON.stringify(fact.review?.context)).toContain('the sloping land beside a river')
    }
    expect(await factOf(unrelated.id)).toEqual(before)
  })

  it('rejects a dependent whose revalidation fails and hides it', async () => {
    const { example, incoming } = await correctedRiverBank('an institution that keeps money')
    llmVerdict('fail')
    await deliverReviews([example.id, incoming.id])

    expect(await factOf(example.id)).toMatchObject({ status: 'rejected', review: { verdict: 'fail' } })
    expect((await factOf(incoming.id)).status).toBe('published')
    const entry = publicEntrySchema.parse((await call('/v1/entries/bank')).body)
    expect(entry.senses[0]?.examples).toEqual([])
  })

  it('keeps dependents published and unmarked when the correction is retracted before they revalidate [spec: facts/revalidate-gloss-retracted]', async () => {
    const { token, correction, example, incoming } = await correctedRiverBank('the sloping land beside a river')
    const ids = [example.id, incoming.id]
    expect(await marks(ids)).toEqual([expect.any(String), expect.any(String)])
    const retract = await call(`/manage/v1/facts/${correction.id}/retract`, { method: 'POST', token })
    expect(factSchema.parse(retract.body).status).toBe('retracted')
    const reviewsBefore = (await Promise.all(ids.map(factOf))).map((fact) => fact.review)

    const reviewer = llmVerdict('fail')
    expect((await deliverReviews(ids)).explicitAcks).toEqual(['m0', 'm1'])
    expect(reviewer).not.toHaveBeenCalled()
    const after = await Promise.all(ids.map(factOf))
    expect(after.map((fact) => fact.status)).toEqual(['published', 'published'])
    expect(after.map((fact) => fact.review)).toEqual(reviewsBefore)
    expect(await marks(ids)).toEqual([null, null])
  })

  it('re-reviews a pending dependent whose gloss a correction replaced mid-review [spec: facts/pending-dependent-api]', async () => {
    const token = await issueAgentKey()
    const post = async (path: string, json: unknown) => (await call(path, { method: 'POST', token, json })).body
    const bank = createEntryResultSchema.parse(await post('/manage/v1/entries', { lemma: 'bank' }))
    const river = createSenseResultSchema.parse(
      await post('/manage/v1/senses', { entry_id: bank.entry.id, pos: 'noun', gloss: 'land beside a river' }),
    )
    stubReviewers()
    await deliverPendingReviews()
    vi.restoreAllMocks()
    const submit = async (json: unknown) => factWriteResultSchema.parse(await post('/manage/v1/facts', json)).fact
    const example = await submit({ kind: 'example', subject_id: river.sense.id, payload: { text: 'We sat on it.' } })
    const correction = await submit({
      kind: 'sense',
      subject_id: river.sense.id,
      supersedes_id: river.fact.id,
      payload: { gloss: 'the sloping land beside a river' },
    })

    const judgedGlosses: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      const body = (await request.json()) as { questions?: Record<string, unknown>; messages?: { content: string }[] }
      if (request.url.endsWith('/v1/systemone')) {
        const answers = Object.fromEntries(
          Object.keys(body.questions ?? {}).map((key) => [key, { type: 'noul', noul: 0.9 }]),
        )
        return Response.json({ model: 'jev-test', answers })
      }
      const prompt = body.messages?.at(-1)?.content ?? ''
      judgedGlosses.push(prompt.includes('the sloping land') ? 'new' : 'old')
      if (judgedGlosses.length === 1) await deliverReviews([correction.id])
      const content = JSON.stringify({ verdict: 'pass', confidence: 0.9, reason: 'Judged.' })
      return Response.json({ model: 'llm-test', choices: [{ message: { content } }] })
    })

    expect((await deliverReviews([example.id])).explicitAcks).toEqual(['m0'])
    expect((await factOf(correction.id)).status).toBe('published')
    expect(await factOf(example.id)).toMatchObject({ status: 'pending', review: null })
    expect(await marks([example.id])).toEqual([expect.any(String)])

    await deliverReviews([example.id])
    expect(judgedGlosses).toEqual(['old', 'new'])
    const reviewed = await factOf(example.id)
    expect(reviewed.status).toBe('published')
    expect(JSON.stringify(reviewed.review?.context)).toContain('the sloping land beside a river')
    expect(await marks([example.id])).toEqual([null])
  })
})
