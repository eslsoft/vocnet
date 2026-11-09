import {
  createEntryResultSchema,
  createSenseResultSchema,
  managedEntrySchema,
  publicEntrySchema,
} from '@shared/catalog'
import { type FactDto, factSchema, factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminToken, call, deliverPendingReviews, issueAgentKey, stubReviewers } from './helpers'

async function publishedRiverBank() {
  const token = await issueAgentKey()
  const { entry } = createEntryResultSchema.parse(
    (await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'bank' } })).body,
  )
  const { sense, fact: gloss } = createSenseResultSchema.parse(
    (
      await call('/manage/v1/senses', {
        method: 'POST',
        token,
        json: { entry_id: entry.id, pos: 'noun', gloss: 'land beside a river' },
      })
    ).body,
  )
  stubReviewers()
  await deliverPendingReviews()
  vi.restoreAllMocks()
  const correct = (text: string) =>
    call('/manage/v1/facts', {
      method: 'POST',
      token,
      json: { kind: 'sense', subject_id: sense.id, supersedes_id: gloss.id, payload: { gloss: text } },
    })
  return { token, entry, sense, gloss, correct }
}

async function factOf(id: string): Promise<FactDto> {
  return factSchema.parse((await call(`/manage/v1/facts/${id}`, { token: await adminToken() })).body)
}

const codeOf = (body: unknown) => apiErrorSchema.parse(body).error.code

describe('exclusive fact slots', () => {
  afterEach(() => vi.restoreAllMocks())

  it('publishes a correction and supersedes the original in one write [spec: facts/supersede-api]', async () => {
    const { gloss, correct } = await publishedRiverBank()
    const correction = factWriteResultSchema.parse((await correct('sloping land beside a river')).body).fact

    stubReviewers()
    await deliverPendingReviews()

    expect((await factOf(correction.id)).status).toBe('published')
    expect((await factOf(gloss.id)).status).toBe('superseded')
    const entry = publicEntrySchema.parse((await call('/v1/entries/bank')).body)
    expect(entry.senses.map((sense) => sense.gloss)).toEqual(['sloping land beside a river'])
  })

  it('sends a rejected fact back through review until it publishes [spec: facts/rereview-api]', async () => {
    const token = await issueAgentKey()
    const { fact } = createEntryResultSchema.parse(
      (await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'lake' } })).body,
    )
    stubReviewers(0.1, 'fail')
    await deliverPendingReviews()
    expect((await factOf(fact.id)).status).toBe('rejected')

    const reset = await call(`/manage/v1/facts/${fact.id}/rereview`, { method: 'POST', token: await adminToken() })
    expect(factSchema.parse(reset.body).status).toBe('pending')

    vi.restoreAllMocks()
    stubReviewers()
    await deliverPendingReviews()
    expect(await factOf(fact.id)).toMatchObject({ status: 'published', review: { verdict: 'pass' } })
    expect((await call('/v1/entries/lake')).status).toBe(200)
  })

  it('admits one of two concurrent corrections [spec: facts/exclusive-slot-race]', async () => {
    const { entry, correct } = await publishedRiverBank()
    const results = await Promise.all([correct('sloping land beside a river'), correct('the edge of a river')])
    expect(results.map(({ status }) => status).sort()).toEqual([201, 409])
    expect(codeOf(results.find(({ status }) => status === 409)?.body)).toBe('conflict')

    const managed = managedEntrySchema.parse(
      (await call(`/manage/v1/entries/${entry.lemma}`, { token: await adminToken() })).body,
    )
    const glosses = managed.facts.filter((fact) => fact.kind === 'sense')
    expect(glosses.map((fact) => fact.status).sort()).toEqual(['pending', 'published'])
  })

  it('lets a re-review race a correction without two pending glosses', async () => {
    const { gloss, correct } = await publishedRiverBank()
    const admin = await adminToken()
    const results = await Promise.all([
      call(`/manage/v1/facts/${gloss.id}/rereview`, { method: 'POST', token: admin }),
      correct('sloping land beside a river'),
    ])
    expect(results.filter(({ status }) => status === 409)).toHaveLength(1)
  })

  it('refuses a re-review that would put a second live fact in the slot [spec: facts/rereview-conflict]', async () => {
    const { token, sense, gloss, correct } = await publishedRiverBank()
    const admin = await adminToken()
    const correction = factWriteResultSchema.parse((await correct('sloping land beside a river')).body).fact
    const whilePending = await call(`/manage/v1/facts/${gloss.id}/rereview`, { method: 'POST', token: admin })
    expect([whilePending.status, codeOf(whilePending.body)]).toEqual([409, 'conflict'])

    stubReviewers(0.1, 'fail')
    await deliverPendingReviews()
    vi.restoreAllMocks()
    expect((await factOf(correction.id)).status).toBe('rejected')
    const example = { kind: 'example', subject_id: sense.id, payload: { text: 'We sat on the bank.' } }
    const rejected = factWriteResultSchema.parse(
      (await call('/manage/v1/facts', { method: 'POST', token, json: example })).body,
    ).fact
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({
        model: 'llm-test',
        choices: [{ message: { content: JSON.stringify({ verdict: 'fail', confidence: 0.9, reason: 'No.' }) } }],
      }),
    )
    await deliverPendingReviews()
    vi.restoreAllMocks()
    expect((await factOf(rejected.id)).status).toBe('rejected')
    await call('/manage/v1/facts', { method: 'POST', token, json: example })

    const contentTaken = await call(`/manage/v1/facts/${rejected.id}/rereview`, { method: 'POST', token: admin })
    expect([contentTaken.status, codeOf(contentTaken.body)]).toEqual([409, 'conflict'])
    expect((await factOf(rejected.id)).status).toBe('rejected')
  })

  it('refuses to re-review a rejected correction whose original another correction superseded [spec: facts/rereview-orphaned-correction]', async () => {
    const { token, sense, gloss, correct } = await publishedRiverBank()
    const rejected = factWriteResultSchema.parse((await correct('a kind of fish')).body).fact
    stubReviewers(0.1, 'fail')
    await deliverPendingReviews()
    vi.restoreAllMocks()
    const winner = factWriteResultSchema.parse((await correct('sloping land beside a river')).body).fact
    stubReviewers()
    await deliverPendingReviews()
    vi.restoreAllMocks()
    expect((await factOf(gloss.id)).status).toBe('superseded')

    const reset = await call(`/manage/v1/facts/${rejected.id}/rereview`, { method: 'POST', token: await adminToken() })
    expect([reset.status, codeOf(reset.body)]).toEqual([409, 'conflict'])
    expect((await factOf(rejected.id)).status).toBe('rejected')

    const next = await call('/manage/v1/facts', {
      method: 'POST',
      token,
      json: {
        kind: 'sense',
        subject_id: sense.id,
        supersedes_id: winner.id,
        payload: { gloss: 'the edge of a river' },
      },
    })
    expect(next.status).toBe(201)
  })

  it('creates one sense from two concurrent identical requests [spec: catalog/create-sense-race]', async () => {
    const token = await issueAgentKey()
    const { entry } = createEntryResultSchema.parse(
      (await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'bank' } })).body,
    )
    const create = () =>
      call('/manage/v1/senses', {
        method: 'POST',
        token,
        json: { entry_id: entry.id, pos: 'noun', gloss: 'land beside a river' },
      })
    const results = await Promise.all([create(), create()])
    expect(results.map(({ status }) => status).sort()).toEqual([200, 201])
    const [first, second] = results.map(({ body }) => createSenseResultSchema.parse(body))
    expect(second?.sense.id).toBe(first?.sense.id)
    expect(second?.fact.id).toBe(first?.fact.id)

    const managed = managedEntrySchema.parse(
      (await call('/manage/v1/entries/bank', { token: await adminToken() })).body,
    )
    expect(managed.senses).toHaveLength(1)
    expect(managed.facts.filter((fact) => fact.kind === 'sense')).toHaveLength(1)
  })
})
