import { env } from 'cloudflare:test'
import { createDeps } from '@server/composition'
import { projectPublicEntry, projectPublicSense } from '@server/domain/catalog-view'
import type { Lemma } from '@server/domain/term'
import {
  createEntryResultSchema,
  createSenseResultSchema,
  entryPageSchema,
  formLookupSchema,
  publicEntrySchema,
} from '@shared/catalog'
import { factWriteResultSchema, type SenseId } from '@shared/facts'
import { publicRebuildResultSchema } from '@shared/public-view'
import { topicSensePageSchema } from '@shared/topics'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adminToken,
  call,
  deliverPendingReviews,
  importLearnerData,
  issueAgentKey,
  request,
  stubReviewers,
} from './helpers'

const DOCUMENT_CACHE = 'public, max-age=60, stale-while-revalidate=300'
const LIST_CACHE = 'public, max-age=15, stale-while-revalidate=60'

/** "bank" with a plural form and a topic-tagged river sense, linked by a synonym to "shore"; all published. */
async function seedBank() {
  const token = await issueAgentKey()
  const post = async (path: string, json: unknown) => (await call(path, { method: 'POST', token, json })).body
  const bank = createEntryResultSchema.parse(await post('/manage/v1/entries', { lemma: 'bank' }))
  const shore = createEntryResultSchema.parse(await post('/manage/v1/entries', { lemma: 'shore' }))
  const river = createSenseResultSchema.parse(
    await post('/manage/v1/senses', { entry_id: bank.entry.id, pos: 'noun', gloss: 'Land beside a river.' }),
  )
  const coast = createSenseResultSchema.parse(
    await post('/manage/v1/senses', { entry_id: shore.entry.id, pos: 'noun', gloss: 'Land along water.' }),
  )
  const submit = async (json: unknown) => factWriteResultSchema.parse(await post('/manage/v1/facts', json)).fact
  await submit({ kind: 'form', subject_id: bank.entry.id, payload: { form: 'banks', type: 'plural' } })
  await submit({ kind: 'topic', subject_id: river.sense.id, payload: { topic_id: 'family' } })
  await submit({
    kind: 'relation',
    subject_id: river.sense.id,
    payload: { type: 'synonym', target_sense_id: coast.sense.id },
  })
  stubReviewers()
  await deliverPendingReviews()
  return { token, bank, shore, river, coast, submit }
}

const entryOf = async (lemma: string) => publicEntrySchema.parse((await call(`/v1/entries/${lemma}`)).body)
const listed = async () => entryPageSchema.parse((await call('/v1/entries')).body).items.map((item) => item.lemma)
const tagged = async () =>
  topicSensePageSchema.parse((await call('/v1/topics/people-feelings/senses')).body).items.map((item) => item.id)
const staleViews = async () =>
  (await env.DB.prepare('SELECT count(*) AS n FROM worklist WHERE revision <> view_revision').first<{ n: number }>())?.n

describe('public view', () => {
  afterEach(() => vi.restoreAllMocks())

  it('moves an entry in and out of every public read as it is published and retracted [spec: public-view/publish]', async () => {
    const { token, bank, river } = await seedBank()
    expect((await call('/v1/entries/bank')).status).toBe(200)
    expect((await call(`/v1/senses/${river.sense.id}`)).status).toBe(200)
    expect(formLookupSchema.parse((await call('/v1/forms/banks')).body).items).toEqual([
      expect.objectContaining({ entry: { id: bank.entry.id, lemma: 'bank' } }),
    ])
    expect(await listed()).toEqual(['bank', 'shore'])
    expect(await tagged()).toEqual([river.sense.id])
    expect(await staleViews()).toBe(0)

    await call(`/manage/v1/facts/${bank.fact.id}/retract`, { method: 'POST', token })
    expect((await call('/v1/entries/bank')).status).toBe(404)
    expect((await call(`/v1/senses/${river.sense.id}`)).status).toBe(404)
    expect((await call('/v1/forms/banks')).status).toBe(404)
    expect(await listed()).toEqual(['shore'])
    expect(await tagged()).toEqual([])
    const rows = await env.DB.prepare(
      'SELECT (SELECT count(*) FROM public_entries WHERE entry_id = ?1) + (SELECT count(*) FROM public_forms WHERE entry_id = ?1) + (SELECT count(*) FROM public_sense_topics WHERE entry_id = ?1) AS n',
    )
      .bind(bank.entry.id)
      .first<{ n: number }>()
    expect(rows?.n).toBe(0)
  })

  it('updates the linked entry when the other end of its relation changes [spec: public-view/linked]', async () => {
    const { token, shore, coast, submit } = await seedBank()
    const relatedGloss = async () =>
      (await entryOf('bank')).senses[0]?.relations.map((relation) => relation.sense.gloss)
    expect(await relatedGloss()).toEqual(['Land along water.'])

    await submit({
      kind: 'sense',
      subject_id: coast.sense.id,
      supersedes_id: coast.fact.id,
      payload: { gloss: 'The land along the edge of the sea.' },
    })
    await deliverPendingReviews()
    // No read has rebuilt it: the review's own refresh did.
    expect(await staleViews()).toBe(0)
    expect(await relatedGloss()).toEqual(['The land along the edge of the sea.'])

    await call(`/manage/v1/facts/${shore.fact.id}/retract`, { method: 'POST', token })
    expect(await staleViews()).toBe(0)
    expect(await relatedGloss()).toEqual([])
  })

  it('carries a reference import into the documents and keeps the scores current [spec: public-view/reference]', async () => {
    await importLearnerData({ zipf: { bank: 5.1 } })
    await seedBank()
    expect((await entryOf('bank')).frequency).toMatchObject({ zipf: 5.1 })

    await importLearnerData({ zipf: { bank: 4.2 }, levels: { bank: 'A2' } })
    expect(await staleViews()).toBe(2)
    const scores = await env.DB.prepare('SELECT count(*) AS n FROM worklist WHERE revision <> scored_revision').first()
    expect(scores).toEqual({ n: 0 })
    const bank = await entryOf('bank')
    expect(bank.frequency).toMatchObject({ zipf: 4.2 })
    expect(bank.cefr).toEqual([{ pos: 'noun', level: 'A2', source_id: 'cefr' }])
  })

  it('serves documents with an ETag and Cache-Control and answers 304 while unchanged [spec: public-view/http-cache]', async () => {
    const { river, submit } = await seedBank()
    for (const path of ['/v1/entries/bank', `/v1/senses/${river.sense.id}`, '/v1/forms/banks']) {
      const first = await request(path)
      const etag = first.headers.get('etag')
      expect(etag).toMatch(/^"[0-9a-f]{32}"$/)
      expect(first.headers.get('cache-control')).toBe(DOCUMENT_CACHE)
      const again = await request(path, { headers: { 'if-none-match': `W/"other", ${etag}` } })
      expect(again.status).toBe(304)
      expect(await again.text()).toBe('')
      expect(again.headers.get('etag')).toBe(etag)
      expect((await request(path, { headers: { 'if-none-match': '"other"' } })).status).toBe(200)
    }
    for (const path of ['/v1/entries', '/v1/topics/people-feelings/senses']) {
      expect((await request(path)).headers.get('cache-control')).toBe(LIST_CACHE)
    }

    const etag = async () => (await request('/v1/entries/bank')).headers.get('etag')
    const before = await etag()
    // Feedback bumps the revision but changes nothing public, so the ETag holds.
    await call('/v1/feedback', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '203.0.113.9' },
      json: { target_type: 'fact', target_id: river.fact.id, message: 'Too vague.' },
    })
    const revision = await env.DB.prepare('SELECT revision, view_revision FROM worklist WHERE entry_id = ?')
      .bind(river.sense.entry_id)
      .first<{ revision: number; view_revision: number }>()
    expect(revision?.view_revision).toBe(revision?.revision)
    expect(await etag()).toBe(before)
    await submit({ kind: 'example', subject_id: river.sense.id, payload: { text: 'We sat on the bank.' } })
    await deliverPendingReviews()
    expect(await etag()).not.toBe(before)
  })

  it('rebuilds stale views on read and lets an admin drain the rest [spec: public-view/rebuild]', async () => {
    const { token } = await seedBank()
    // What the backfill migration leaves: every view stale and no view rows.
    await env.DB.batch(
      [
        'UPDATE worklist SET view_revision = revision - 1',
        'DELETE FROM public_forms',
        'DELETE FROM public_sense_topics',
        'DELETE FROM public_entries',
      ].map((statement) => env.DB.prepare(statement)),
    )
    expect((await call('/v1/entries/bank')).status).toBe(200)
    // Lists read only built views; the sweep and the admin drain build the rest.
    expect(await listed()).toEqual(['bank'])

    const rebuild = (as: string, limit: number) =>
      call('/manage/v1/public/rebuild', { method: 'POST', token: as, json: { limit } })
    expect((await rebuild(token, 1)).status).toBe(403)
    const admin = await adminToken()
    expect(publicRebuildResultSchema.parse((await rebuild(admin, 1)).body)).toEqual({ rebuilt: 1, remaining: 0 })
    expect(publicRebuildResultSchema.parse((await rebuild(admin, 1)).body)).toEqual({ rebuilt: 0, remaining: 0 })
    expect(await listed()).toEqual(['bank', 'shore'])
    expect((await rebuild(admin, 0)).status).toBe(400)
  })

  it('serves bodies byte-identical to the live projection [spec: public-view/parity]', async () => {
    await importLearnerData({ zipf: { bank: 5.1, shore: 4 }, levels: { bank: 'A1' } })
    const { river, coast } = await seedBank()
    const deps = createDeps(env)
    for (const [lemma, senseId] of [
      ['bank', river.sense.id],
      ['shore', coast.sense.id],
    ] as Array<[Lemma, SenseId]>) {
      const entry = await deps.nodes.findEntryByLemma(lemma)
      if (!entry) throw new Error(`No entry ${lemma}.`)
      const snapshot = await deps.nodes.loadEntrySnapshot(entry)
      const live = { ...projectPublicEntry(snapshot), ...(await deps.reference.forLemma(lemma)) }
      expect(await (await request(`/v1/entries/${lemma}`)).text()).toBe(JSON.stringify(live))
      expect(await (await request(`/v1/senses/${senseId}`)).text()).toBe(
        JSON.stringify(projectPublicSense(snapshot, senseId)),
      )
    }
  })
})
