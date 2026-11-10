import { env } from 'cloudflare:test'
import { issuedAgentSchema } from '@shared/agents'
import {
  createEntryResultSchema,
  createSenseResultSchema,
  managedEntrySchema,
  publicEntrySchema,
} from '@shared/catalog'
import { type FactDto, factPageSchema, factSchema, factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminToken, call, deliverPendingReviews, importLearnerData, issueAgentKey, stubReviewers } from './helpers'

async function curatorKey(): Promise<string> {
  const { status, body } = await call('/manage/v1/agents', {
    method: 'POST',
    token: await adminToken(),
    json: { name: 'Curator', curator: true },
  })
  expect(status).toBe(201)
  const issued = issuedAgentSchema.parse(body)
  expect(issued.agent.curator).toBe(true)
  return issued.key
}

const post = (token: string, path: string, json: unknown) => call(path, { method: 'POST', token, json })
const codeOf = (body: unknown) => apiErrorSchema.parse(body).error.code
const factOf = async (id: string): Promise<FactDto> =>
  factSchema.parse((await call(`/manage/v1/facts/${id}`, { token: await adminToken() })).body)
const curated = { reason: 'Checked by hand.' }

/** An entry with one noun sense whose gloss is published. */
async function senseOf(token: string, lemma: string, gloss: string) {
  const { entry } = createEntryResultSchema.parse((await post(token, '/manage/v1/entries', { lemma })).body)
  const created = createSenseResultSchema.parse(
    (await post(token, '/manage/v1/senses', { entry_id: entry.id, pos: 'noun', gloss })).body,
  )
  stubReviewers()
  await deliverPendingReviews()
  vi.restoreAllMocks()
  return { entry, sense: created.sense, gloss: created.fact }
}

const submit = async (token: string, json: unknown) =>
  factWriteResultSchema.parse((await post(token, '/manage/v1/facts', json)).body).fact
const example = (senseId: string, text: string) => ({ kind: 'example', subject_id: senseId, payload: { text } })

/** Submits facts as the producer and reviews them with the LLM answering `verdict`. */
async function producedAs(token: string, verdict: 'pass' | 'uncertain' | 'fail', facts: unknown[]) {
  const written = []
  for (const json of facts) written.push(await submit(token, json))
  stubReviewers(0.6, verdict)
  await deliverPendingReviews()
  vi.restoreAllMocks()
  return Promise.all(written.map((fact) => factOf(fact.id)))
}

describe('curation', () => {
  afterEach(() => vi.restoreAllMocks())

  it('refuses curation to producers and grants it to a curator key [spec: curation/curator-only]', async () => {
    const producer = await issueAgentKey('producer')
    const curator = await curatorKey()
    const { sense } = await senseOf(producer, 'kettle', 'A pot for boiling water.')

    const refused = await post(producer, '/manage/v1/facts', {
      ...example(sense.id, 'Put the kettle on.'),
      curation: curated,
    })
    expect(refused.status).toBe(403)
    expect(codeOf(refused.body)).toBe('forbidden')
    const pending = await submit(producer, example(sense.id, 'The kettle boiled.'))
    const settle = await post(producer, `/manage/v1/facts/${pending.id}/curate`, { verdict: 'pass', reason: 'x' })
    expect(settle.status).toBe(403)
    expect(codeOf(settle.body)).toBe('forbidden')

    const settled = await post(curator, `/manage/v1/facts/${pending.id}/curate`, { verdict: 'fail', reason: 'Dull.' })
    expect(settled.status).toBe(200)
    expect(factSchema.parse(settled.body)).toMatchObject({ status: 'rejected', review: { reviewer: 'curator' } })
  })

  it('publishes a curated fact without a queue delivery [spec: curation/direct-write-api]', async () => {
    const curator = await curatorKey()
    const { sense } = await senseOf(curator, 'jeans', 'Trousers made of denim.')
    const result = await post(curator, '/manage/v1/facts', {
      ...example(sense.id, 'My jeans are blue.'),
      curation: curated,
    })
    expect(result.status).toBe(201)
    const { fact } = factWriteResultSchema.parse(result.body)
    expect(fact).toMatchObject({
      status: 'published',
      review: { reviewer: 'curator', verdict: 'pass', confidence: 1, reason: curated.reason },
    })
    expect(fact.review?.model).toMatch(/^agent:/)

    const entry = publicEntrySchema.parse((await call('/v1/entries/jeans')).body)
    expect(entry.meanings[0]?.senses[0]?.examples.map((item) => item.text)).toEqual(['My jeans are blue.'])
  })

  it('settles weak and rejected facts and rescores the entry [spec: curation/settle-api]', async () => {
    const producer = await issueAgentKey('producer')
    const curator = await curatorKey()
    const { sense } = await senseOf(producer, 'shelve', 'A verb-like noun for testing.')
    const [weak] = await producedAs(producer, 'uncertain', [example(sense.id, 'Shelve the books.')])
    const [rejected] = await producedAs(producer, 'fail', [example(sense.id, 'They shelved the plan.')])
    expect(weak?.review?.verdict).toBe('uncertain')
    expect(rejected?.status).toBe('rejected')
    const qualityOf = async () =>
      managedEntrySchema.parse((await call('/manage/v1/entries/shelve', { token: curator })).body).quality
    expect(await qualityOf()).toBeLessThan(1)

    for (const fact of [weak, rejected]) {
      const settled = await post(curator, `/manage/v1/facts/${fact?.id}/curate`, { verdict: 'pass', reason: 'Right.' })
      expect(settled.status).toBe(200)
      expect(factSchema.parse(settled.body)).toMatchObject({
        status: 'published',
        review: { reviewer: 'curator', verdict: 'pass', confidence: 1 },
      })
    }
    expect(await qualityOf()).toBe(1)

    const again = await post(curator, `/manage/v1/facts/${rejected?.id}/curate`, { verdict: 'fail', reason: 'No.' })
    expect(factSchema.parse(again.body).status).toBe('rejected')
    await submit(curator, { ...example(sense.id, 'They shelved the plan.'), curation: curated })
    const collision = await post(curator, `/manage/v1/facts/${rejected?.id}/curate`, { verdict: 'pass', reason: 'x' })
    expect(collision.status).toBe(409)
    expect(codeOf(collision.body)).toBe('conflict')
  })

  it('never marks a curated fact when a gloss correction publishes [spec: curation/never-revalidated]', async () => {
    const producer = await issueAgentKey('producer')
    const curator = await curatorKey()
    const { sense, gloss } = await senseOf(producer, 'clock', 'A device that shows the time.')
    const mine = await submit(curator, { ...example(sense.id, 'The clock ticked.'), curation: curated })
    const [theirs] = await producedAs(producer, 'pass', [example(sense.id, 'The clock stopped.')])
    await producedAs(producer, 'pass', [
      {
        kind: 'sense',
        subject_id: sense.id,
        supersedes_id: gloss.id,
        payload: { gloss: 'An instrument for telling time.' },
      },
    ])
    const read = env.DB.prepare('SELECT revalidate_since AS mark FROM facts WHERE id = ?')
    expect((await read.bind(mine.id).first<{ mark: string | null }>())?.mark).toBeNull()
    expect((await read.bind(theirs?.id).first<{ mark: string | null }>())?.mark).not.toBeNull()

    const supersede = await post(producer, '/manage/v1/facts', {
      ...example(sense.id, 'The clock ticked loudly.'),
      supersedes_id: mine.id,
    })
    expect(supersede.status).toBe(403)
    expect(codeOf(supersede.body)).toBe('curated_fact')
    const retract = await post(producer, `/manage/v1/facts/${mine.id}/retract`, {})
    expect(codeOf(retract.body)).toBe('forbidden')
  })

  it('lists weak facts by kind and CEFR level [spec: curation/weak-list]', async () => {
    await importLearnerData({ levels: { pail: 'A1', bucket: 'B2' } })
    const producer = await issueAgentKey('producer')
    const curator = await curatorKey()
    const pail = await senseOf(producer, 'pail', 'An open container with a handle.')
    const bucket = await senseOf(producer, 'bucket', 'An open container for carrying water.')
    const [weakA1, weakB2] = await producedAs(producer, 'uncertain', [
      example(pail.sense.id, 'Fill the pail.'),
      example(bucket.sense.id, 'Fill the bucket.'),
    ])
    await producedAs(producer, 'pass', [example(pail.sense.id, 'The pail leaked.')])

    const list = async (query: string) =>
      factPageSchema.parse((await call(`/manage/v1/facts?${query}`, { token: curator })).body).items.map((f) => f.id)
    expect(await list('weak=true&kind=example&level=A1')).toEqual([weakA1?.id])
    expect(await list('weak=true&kind=example&level=B2')).toEqual([weakB2?.id])
    expect(await list('weak=true&kind=sense&level=A1')).toEqual([])
    expect(await list('weak=true&kind=example&level=B2&limit=1')).toHaveLength(1)
  })
})
