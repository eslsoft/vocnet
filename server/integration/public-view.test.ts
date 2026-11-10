import { env } from 'cloudflare:test'
import { createDeps } from '@server/composition'
import { projectPublicEntry, type StoredEntry } from '@server/domain/catalog-view'
import {
  publicViewRecord,
  type ReadVariant,
  readStored,
  shapeEntry,
  shapeSenseDetail,
} from '@server/domain/public-view'
import type { Lemma } from '@server/domain/term'
import { topicNamesOf } from '@server/usecases/public-view'
import {
  createEntryResultSchema,
  createSenseResultSchema,
  entryPageSchema,
  formLookupSchema,
  publicEntrySchema,
  publicSenseDetailSchema,
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

const DOCUMENT_CACHE = 'public, no-cache'
const LIST_CACHE = 'public, max-age=5'

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
  topicSensePageSchema.parse((await call('/v1/topics/people-feelings/senses')).body).items.map((item) => item.sense_id)
/** Every stored view row of the entry and its view revision, to compare across a save. */
const viewRowsOf = (entryId: string) =>
  env.DB.batch(
    [
      'SELECT document, digest, built_at FROM public_entries WHERE entry_id = ?1',
      'SELECT content_key, type, pos FROM public_forms WHERE entry_id = ?1 ORDER BY content_key, pos',
      'SELECT topic_id, sense_id, summary FROM public_sense_topics WHERE entry_id = ?1 ORDER BY topic_id, sense_id',
      'SELECT word FROM public_phrase_words WHERE entry_id = ?1 ORDER BY word',
      'SELECT form, role FROM public_morphemes WHERE entry_id = ?1 ORDER BY form, role',
      'SELECT revision, view_revision FROM worklist WHERE entry_id = ?1',
    ].map((statement) => env.DB.prepare(statement).bind(entryId)),
  ).then((results) => results.map((result) => result.results))
const staleViews = async () =>
  (await env.DB.prepare('SELECT count(*) AS n FROM worklist WHERE revision <> view_revision').first<{ n: number }>())?.n

describe('public view', () => {
  afterEach(() => vi.restoreAllMocks())

  it('moves an entry in and out of every public read as it is published and retracted [spec: public-view/publish]', async () => {
    const { token, bank, river } = await seedBank()
    expect((await call('/v1/entries/bank')).status).toBe(200)
    expect((await call(`/v1/senses/${river.sense.id}`)).status).toBe(200)
    expect(formLookupSchema.parse((await call('/v1/forms/banks')).body).items).toEqual([
      expect.objectContaining({ lemma: 'bank', matches: [{ type: 'plural', pos: 'noun' }] }),
    ])
    expect(await listed()).toEqual(['bank', 'shore'])
    expect(await tagged()).toEqual([river.sense.id])
    expect(await staleViews()).toBe(0)
    expect(bank.entry.lemma).toBe('bank')

    await call(`/manage/v1/facts/${bank.fact.id}/retract`, { method: 'POST', token })
    expect((await call('/v1/entries/bank')).status).toBe(404)
    expect((await call(`/v1/senses/${river.sense.id}`)).status).toBe(404)
    expect((await call('/v1/forms/banks')).status).toBe(404)
    expect(await listed()).toEqual(['shore'])
    expect(await tagged()).toEqual([])
    const rows = await env.DB.prepare(
      'SELECT (SELECT count(*) FROM public_entries WHERE entry_id = ?1) + (SELECT count(*) FROM public_forms WHERE entry_id = ?1) + (SELECT count(*) FROM public_sense_topics WHERE entry_id = ?1) + (SELECT count(*) FROM public_phrase_words WHERE entry_id = ?1) + (SELECT count(*) FROM public_morphemes WHERE entry_id = ?1) AS n',
    )
      .bind(bank.entry.id)
      .first<{ n: number }>()
    expect(rows?.n).toBe(0)
  })

  it('updates the linked entry when the other end of its relation changes [spec: public-view/linked]', async () => {
    const { token, shore, coast, submit } = await seedBank()
    const relatedGloss = async () =>
      (await entryOf('bank')).meanings[0]?.senses[0]?.relations.synonyms.map((related) => related.gloss)
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
    expect(bank.frequency).toEqual({ zipf: 4.2, rank: 1 })
    expect(bank.meanings[0]?.cefr).toBe('A2')
    expect(entryPageSchema.parse((await call('/v1/entries?prefix=bank')).body).items[0]?.cefr).toBe('A2')
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
      // Another variant of the same document has its own ETag.
      expect((await request(`${path}?lang=zh`)).headers.get('etag')).not.toBe(etag)
    }
    for (const path of ['/v1/entries', '/v1/topics/people-feelings/senses']) {
      const response = await request(path)
      expect(response.headers.get('cache-control')).toBe(LIST_CACHE)
      expect(response.headers.get('vary')).toBe('Accept-Language')
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
        'DELETE FROM public_phrase_words',
        'DELETE FROM public_morphemes',
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

  it('stores nothing from a rebuild whose revision moved before it saved [spec: public-view/lost-update]', async () => {
    const { bank, submit } = await seedBank()
    await submit({
      kind: 'morphology',
      subject_id: bank.entry.id,
      payload: { parts: [{ form: 'bank', role: 'base' }] },
    })
    await deliverPendingReviews()
    const { publicViews } = createDeps(env)
    const built = await viewRowsOf(bank.entry.id)
    const [documentRow] = built[0] as Array<{ document: string }>
    if (!documentRow) throw new Error('bank has no stored document.')
    const document = readStored<StoredEntry>(documentRow.document)
    expect(built[1]).toHaveLength(1)
    expect(built[2]).toHaveLength(1)
    expect(built[3]).toHaveLength(0)
    expect(built[4]).toHaveLength(1)

    // A rebuild loads the stale revision, then another write bumps it before the rebuild saves.
    await env.DB.prepare('UPDATE worklist SET revision = revision + 1 WHERE entry_id = ?').bind(bank.entry.id).run()
    const [stale] = await publicViews.listStale([bank.entry.id])
    if (!stale) throw new Error('bank is not stale.')
    await env.DB.prepare('UPDATE worklist SET revision = revision + 1 WHERE entry_id = ?').bind(bank.entry.id).run()
    const moved = await viewRowsOf(bank.entry.id)

    await publicViews.save(
      stale,
      publicViewRecord({ ...document, lemma: 'bank up', meanings: [], morphology: null, frequency: null }),
    )
    expect(await viewRowsOf(bank.entry.id)).toEqual(moved)
    await publicViews.save(stale, null)
    expect(await viewRowsOf(bank.entry.id)).toEqual(moved)
    expect(moved.slice(0, 5)).toEqual(built.slice(0, 5))
  })

  it('finds forms and list rows only once the drain has built them [spec: public-view/drain]', async () => {
    const { bank, river } = await seedBank()
    // What a migration that marks views stale leaves, as public_view_backfill does.
    await env.DB.batch(
      [
        'UPDATE worklist SET view_revision = revision - 1',
        'DELETE FROM public_forms',
        'DELETE FROM public_sense_topics',
        'DELETE FROM public_phrase_words',
        'DELETE FROM public_morphemes',
        'DELETE FROM public_entries',
      ].map((statement) => env.DB.prepare(statement)),
    )
    expect((await call('/v1/forms/banks')).status).toBe(404)
    expect(await listed()).toEqual([])
    expect(await tagged()).toEqual([])

    const admin = await adminToken()
    const drained = await call('/manage/v1/public/rebuild', { method: 'POST', token: admin, json: { limit: 200 } })
    expect(publicRebuildResultSchema.parse(drained.body)).toEqual({ rebuilt: 2, remaining: 0 })
    expect(formLookupSchema.parse((await call('/v1/forms/banks')).body).items).toEqual([
      expect.objectContaining({
        lemma: 'bank',
        gloss: 'Land beside a river.',
        matches: [{ type: 'plural', pos: 'noun' }],
      }),
    ])
    expect(await listed()).toEqual(['bank', 'shore'])
    expect(await tagged()).toEqual([river.sense.id])
    expect(bank.entry.lemma).toBe('bank')
  })

  it('serves every variant as the live projection builds it [spec: public-view/parity]', async () => {
    await importLearnerData({ zipf: { bank: 5.1, shore: 4 }, levels: { bank: 'A1' } })
    const { river, coast, submit } = await seedBank()
    await submit({ kind: 'translation', subject_id: river.sense.id, payload: { language: 'zh', text: '河岸' } })
    await deliverPendingReviews()
    const deps = createDeps(env)
    const topicNames = await topicNamesOf(deps)
    const variants: Array<[string, ReadVariant]> = [
      ['', { lang: null, review: false }],
      ['?lang=zh', { lang: 'zh', review: false }],
      ['?lang=all&include=review', { lang: 'all', review: true }],
    ]
    for (const [lemma, senseId] of [
      ['bank', river.sense.id],
      ['shore', coast.sense.id],
    ] as Array<[Lemma, SenseId]>) {
      const entry = await deps.nodes.findEntryByLemma(lemma)
      if (!entry) throw new Error(`No entry ${lemma}.`)
      const snapshot = await deps.nodes.loadEntrySnapshot(entry)
      const live = projectPublicEntry(snapshot, { reference: await deps.reference.forLemma(lemma), topicNames })
      const found = await deps.publicViews.findByLemma(lemma)
      if (!live || !found) throw new Error(`${lemma} is not public.`)
      for (const [query, variant] of variants) {
        expect(await (await request(`/v1/entries/${lemma}${query}`)).json()).toEqual(
          shapeEntry(live, found.links, variant),
        )
        expect(await (await request(`/v1/senses/${senseId}${query}`)).json()).toEqual(
          shapeSenseDetail(live, senseId, variant),
        )
      }
    }
  })

  it('lists a multiword entry among the phrases of each of its words, joined on read [spec: public-view/phrases]', async () => {
    const { token } = await seedBank()
    const post = async (path: string, json: unknown) => (await call(path, { method: 'POST', token, json })).body
    const publish = async (lemma: string, gloss: string, pos = 'verb') => {
      const created = createEntryResultSchema.parse(await post('/manage/v1/entries', { lemma }))
      await post('/manage/v1/senses', { entry_id: created.entry.id, pos, gloss })
      await deliverPendingReviews()
      return created
    }
    await publish('give', 'To hand something to someone.')
    await publish('up', 'Towards a higher place.', 'adverb')
    const etagOf = async (lemma: string) => (await request(`/v1/entries/${lemma}`)).headers.get('etag')
    const builtAt = () =>
      env.DB.prepare(
        "SELECT built_at FROM public_entries JOIN entries ON entries.id = public_entries.entry_id WHERE entries.lemma = 'give'",
      ).first<{ built_at: string }>()
    const before = await etagOf('give')
    const built = await builtAt()
    expect((await entryOf('give')).phrases).toEqual([])

    const giveUp = await publish('give up', 'To stop trying.')
    for (const lemma of ['give', 'up']) {
      expect((await entryOf(lemma)).phrases).toEqual([
        { lemma: 'give up', pos: ['verb'], cefr: null, gloss: 'To stop trying.' },
      ])
    }
    const listedEtag = await etagOf('give')
    expect(listedEtag).not.toBe(before)
    // Nothing rebuilt "give": the phrase comes from the view rows of "give up".
    expect(await staleViews()).toBe(0)
    expect(await builtAt()).toEqual(built)

    await call(`/manage/v1/facts/${giveUp.fact.id}/retract`, { method: 'POST', token })
    expect((await entryOf('give')).phrases).toEqual([])
    expect((await entryOf('up')).phrases).toEqual([])
    const after = await etagOf('give')
    expect(after).not.toBe(listedEtag)
    expect(await builtAt()).toEqual(built)
  })

  it('lists the entries sharing a base as word family and links the public parts [spec: public-view/family]', async () => {
    const { token } = await seedBank()
    const post = async (path: string, json: unknown) => (await call(path, { method: 'POST', token, json })).body
    const submit = async (json: unknown) => factWriteResultSchema.parse(await post('/manage/v1/facts', json)).fact
    const create = async (lemma: string, gloss: string) => {
      const created = createEntryResultSchema.parse(await post('/manage/v1/entries', { lemma }))
      await post('/manage/v1/senses', { entry_id: created.entry.id, pos: 'noun', gloss })
      return created
    }
    const happy = await create('happy', 'Feeling or showing pleasure.')
    const happiness = await create('happiness', 'The state of being happy.')
    await submit({
      kind: 'morphology',
      subject_id: happy.entry.id,
      payload: { parts: [{ form: 'happy', role: 'base' }] },
    })
    const formation = await submit({
      kind: 'morphology',
      subject_id: happiness.entry.id,
      payload: {
        parts: [
          { form: 'happy', role: 'base' },
          { form: '-ness', role: 'suffix' },
        ],
      },
    })
    await deliverPendingReviews()

    const morphologyOf = async (lemma: string) => (await entryOf(lemma)).morphology
    expect(await morphologyOf('happiness')).toEqual({
      parts: [
        { form: 'happy', role: 'base', lemma: 'happy' },
        { form: '-ness', role: 'suffix' },
      ],
      family: [{ lemma: 'happy', pos: ['noun'], cefr: null, gloss: 'Feeling or showing pleasure.' }],
    })
    expect((await morphologyOf('happy'))?.family.map((member) => member.lemma)).toEqual(['happiness'])

    await submit({
      kind: 'morphology',
      subject_id: happiness.entry.id,
      supersedes_id: formation.id,
      payload: {
        parts: [
          { form: 'happi', role: 'base' },
          { form: '-ness', role: 'suffix' },
        ],
      },
    })
    await deliverPendingReviews()
    expect((await morphologyOf('happiness'))?.family).toEqual([])
    expect((await morphologyOf('happy'))?.family).toEqual([])
  })

  it('reads translations and topic names in the language asked for, with an ETag per language [spec: public-view/language]', async () => {
    const { river, submit } = await seedBank()
    await submit({ kind: 'translation', subject_id: river.sense.id, payload: { language: 'zh', text: '河岸' } })
    await deliverPendingReviews()
    const read = async (query: string, headers: Record<string, string> = {}) => {
      const response = await request(`/v1/entries/bank${query}`, { headers })
      expect(response.headers.get('vary')).toBe('Accept-Language')
      const body = publicEntrySchema.parse(await response.json())
      return { body, sense: body.meanings[0]?.senses[0], etag: response.headers.get('etag') }
    }

    const zh = await read('?lang=zh')
    expect(zh.body.lang).toBe('zh')
    expect(zh.sense?.translations).toEqual(['河岸'])
    expect(zh.sense?.topics).toEqual([{ id: 'family', name: { en: expect.any(String), zh: expect.any(String) } }])
    expect((await read('?lang=zh')).etag).toBe(zh.etag)

    const header = await read('', { 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' })
    expect(header.body.lang).toBe('zh-CN')
    expect(header.sense?.translations).toEqual(['河岸'])
    expect(header.etag).not.toBe(zh.etag)

    const fr = await read('?lang=fr', { 'accept-language': 'zh' })
    expect(fr.body.lang).toBe('fr')
    expect(fr.sense?.translations).toEqual([])
    expect(fr.sense?.topics[0]?.name).toEqual({ en: expect.any(String) })

    const all = await read('?lang=all')
    expect(all.sense?.translations).toEqual({ zh: ['河岸'] })

    const none = await read('')
    expect(none.body.lang).toBeNull()
    expect(none.sense).not.toHaveProperty('translations')
    expect(new Set([zh.etag, fr.etag, all.etag, none.etag]).size).toBe(4)

    const plain = JSON.stringify(none.body)
    expect(plain).not.toContain('"review"')
    expect(plain).not.toContain('fact_id')
    const reviewed = await read('?include=review')
    expect(reviewed.body.review?.entry.fact_id).toEqual(expect.any(String))
    expect(reviewed.sense?.review?.gloss.fact_id).toBe(river.fact.id)
    expect(reviewed.etag).not.toBe(none.etag)

    const summary = entryPageSchema.parse((await call('/v1/entries?lang=zh')).body)
    expect(summary.lang).toBe('zh')
    expect(summary.items[0]).toEqual({
      lemma: 'bank',
      pos: ['noun'],
      cefr: null,
      gloss: 'Land beside a river.',
      translation: '河岸',
    })
    const sense = publicSenseDetailSchema.parse((await call(`/v1/senses/${river.sense.id}?lang=zh`)).body)
    expect(sense).toMatchObject({ lang: 'zh', pos: 'noun', translations: ['河岸'], entry: { translation: '河岸' } })
    for (const path of [`/v1/senses/${river.sense.id}`, '/v1/forms/banks']) {
      expect((await request(path)).headers.get('vary')).toBe('Accept-Language')
    }
    const invalid = await call('/v1/entries/bank?lang=not_a_tag')
    expect(invalid.status).toBe(400)
    expect(invalid.body).toMatchObject({ error: { code: 'invalid_request' } })
  })
})
