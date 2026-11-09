import { env } from 'cloudflare:test'
import { createEntryResultSchema, createSenseResultSchema, publicEntrySchema, statsSchema } from '@shared/catalog'
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

  it('asks the LLM for a second opinion when Jev fails and publishes on its pass [spec: facts/second-opinion-api]', async () => {
    const token = await issueAgentKey()
    const { fact } = createEntryResultSchema.parse(
      (await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'an' } })).body,
    )
    const gateway = stubReviewers(0.2, 'pass')
    expect((await deliverPendingReviews()).explicitAcks).toEqual(['m0'])
    expect(gateway.mock.calls.map(([input]) => new Request(input).url)).toEqual([
      'https://models.test/v1/systemone',
      'https://models.test/v1/chat/completions',
    ])
    const reviewed = factSchema.parse((await call(`/manage/v1/facts/${fact.id}`, { token })).body)
    expect(reviewed).toMatchObject({
      status: 'published',
      review: { reviewer: 'jev+llm', model: 'jev-test+llm-test', verdict: 'pass', confidence: 0.88 },
    })
    expect(reviewed.review?.detail).toMatchObject({
      opinions: [
        { reviewer: 'jev', verdict: 'fail' },
        { reviewer: 'llm', verdict: 'pass' },
      ],
    })
    expect((await call('/v1/entries/an')).status).toBe(200)
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

  it('enforces write rules: one fact per symmetric pair, relations across entries, gloss and ipa format [spec: facts/write-rules-api]', async () => {
    const token = await issueAgentKey()
    const post = (path: string, json: unknown) => call(path, { method: 'POST', token, json })
    const entryOf = async (lemma: string) =>
      createEntryResultSchema.parse((await post('/manage/v1/entries', { lemma })).body).entry
    const [east, west] = [await entryOf('east'), await entryOf('west')]
    const senseOf = async (entryId: string, gloss: string) =>
      createSenseResultSchema.parse((await post('/manage/v1/senses', { entry_id: entryId, pos: 'noun', gloss })).body)
        .sense
    const eastSense = await senseOf(east.id, 'The direction toward the sunrise.')
    const westSense = await senseOf(west.id, 'The direction toward the sunset.')
    const westward = await senseOf(west.id, 'The western part of a region.')

    const antonym = (from: string, to: string) =>
      post('/manage/v1/facts', {
        kind: 'relation',
        subject_id: from,
        payload: { type: 'antonym', target_sense_id: to },
      })
    const first = await antonym(eastSense.id, westSense.id)
    const mirrored = await antonym(westSense.id, eastSense.id)
    expect([first.status, mirrored.status]).toEqual([201, 200])
    const stored = factWriteResultSchema.parse(first.body).fact
    expect(factWriteResultSchema.parse(mirrored.body).fact.id).toBe(stored.id)
    expect(stored.subject_id < (stored.object_id ?? '')).toBe(true)

    const sameEntry = await antonym(westSense.id, westward.id)
    expect(sameEntry.status).toBe(422)
    expect(apiErrorSchema.parse(sameEntry.body).error.code).toBe('invalid_reference')

    const badGloss = await post('/manage/v1/senses', {
      entry_id: east.id,
      pos: 'noun',
      gloss: 'toward the east, as in "go east"',
    })
    expect(badGloss.status).toBe(400)
    expect(apiErrorSchema.parse(badGloss.body).error).toMatchObject({
      code: 'invalid_request',
      message: expect.stringMatching(/capital letter.*period.*no examples/),
    })
    const badIpa = await post('/manage/v1/facts', {
      kind: 'pronunciation',
      subject_id: east.id,
      payload: { ipa: 'iːst, ɪst', accent: 'us' },
    })
    expect(badIpa.status).toBe(400)
    expect(apiErrorSchema.parse(badIpa.body).error.message).toContain('exactly one transcription')
  })

  it('re-orients stored symmetric relations and leaves live duplicates to retract [spec: facts/orient-stored-relations]', async () => {
    const token = await issueAgentKey()
    const post = (path: string, json: unknown) => call(path, { method: 'POST', token, json })
    const senses: string[] = []
    for (const lemma of ['north', 'south', 'up', 'down']) {
      const { entry } = createEntryResultSchema.parse((await post('/manage/v1/entries', { lemma })).body)
      const created = await post('/manage/v1/senses', { entry_id: entry.id, pos: 'noun', gloss: `The ${lemma} side.` })
      senses.push(createSenseResultSchema.parse(created.body).sense.id)
    }
    const [north, south, up, down] = senses.sort() as [string, string, string, string]
    const insert = (id: string, type: string, subject: string, object: string, status: string) =>
      env.DB.prepare(
        `insert into facts (id, kind, subject_id, object_id, content_key, payload, status, exclusive, author, created_at, updated_at)
         values (?, 'relation', ?, ?, ?, ?, ?, 0, 'agent:legacy', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
        .bind(id, subject, object, `${type}|${object}`, JSON.stringify({ type, target_sense_id: object }), status)
        .run()
    const ids = {
      reversed: crypto.randomUUID(),
      duplicate: crypto.randomUUID(),
      twin: crypto.randomUUID(),
      hypernym: crypto.randomUUID(),
    }
    await insert(ids.reversed, 'antonym', south, north, 'published')
    await insert(ids.twin, 'synonym', up, down, 'published')
    await insert(ids.duplicate, 'synonym', down, up, 'published')
    await insert(ids.hypernym, 'hypernym', down, up, 'pending')

    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name.endsWith('orient_symmetric_relations.sql'))
    if (!migration) throw new Error('The orient_symmetric_relations migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()

    const read = async (id: string) => factSchema.parse((await call(`/manage/v1/facts/${id}`, { token })).body)
    expect(await read(ids.reversed)).toMatchObject({
      subject_id: north,
      object_id: south,
      payload: { type: 'antonym', target_sense_id: south },
    })
    expect(await read(ids.duplicate)).toMatchObject({ subject_id: down, object_id: up })
    expect(await read(ids.hypernym)).toMatchObject({ subject_id: down, object_id: up })
    const resubmitted = await post('/manage/v1/facts', {
      kind: 'relation',
      subject_id: south,
      payload: { type: 'antonym', target_sense_id: north },
    })
    expect(resubmitted.status).toBe(200)
    expect(factWriteResultSchema.parse(resubmitted.body).fact.id).toBe(ids.reversed)
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
