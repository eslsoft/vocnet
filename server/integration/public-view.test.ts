import { env } from 'cloudflare:test'
import { createDeps } from '@server/composition'
import { projectPublicEntry, type StoredEntry } from '@server/domain/catalog-view'
import {
  publicViewRecord,
  type ReadVariant,
  readStored,
  shapeEntry,
  shapeSenseDetail,
  topicCategories,
} from '@server/domain/public-view'
import type { Lemma } from '@server/domain/term'
import { topicNamesOf } from '@server/usecases/public-view'
import { entryPageSchema, formLookupSchema, publicEntrySchema, publicSenseDetailSchema } from '@shared/catalog'
import type { SenseId } from '@shared/facts'
import { publicRebuildResultSchema } from '@shared/public-view'
import { topicSensePageSchema } from '@shared/topics'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adminToken,
  call,
  curated,
  deliverPendingReviews,
  headword,
  importLearnerData,
  issueAgentKey,
  managed,
  publishInventory,
  request,
  stubReviewers,
  submitOk,
} from './helpers'

const DOCUMENT_CACHE = 'public, no-cache'
const LIST_CACHE = 'public, max-age=5'

/** "bank" with a plural form and a topic-tagged river sense, linked by a synonym to "shore"; all published. */
async function seedBank() {
  const token = await issueAgentKey()
  const bank = await headword('bank', [{ pos: 'noun', gloss: 'Land beside a river.' }])
  const shore = await headword('shore', [{ pos: 'noun', gloss: 'Land along water.' }])
  const river = bank.senses[0] as SenseId
  const coast = shore.senses[0] as SenseId
  const submit = (kind: string, subjectId: string, payload: unknown, supersedesId?: string) =>
    submitOk(token, kind, subjectId, payload, supersedesId ? { supersedes_id: supersedesId } : {})
  const form = await submit('form', bank.entryId, { form: 'banks', type: 'plural' })
  await submit('topic', river, { topic_id: 'family-and-relationships' })
  await submit('relation', river, { type: 'synonym', target_sense_id: coast })
  stubReviewers()
  await deliverPendingReviews()
  return { token, bank, shore, river, coast, form, submit }
}

const entryOf = async (lemma: string) => publicEntrySchema.parse((await call(`/v1/entries/${lemma}`)).body)
const listed = async () => entryPageSchema.parse((await call('/v1/entries')).body).items.map((item) => item.lemma)
const tagged = async () =>
  topicSensePageSchema.parse((await call('/v1/topics/people/senses')).body).items.map((item) => item.sense_id)
/** Every stored view row of the entry and its view revision, to compare across a save. */
const viewRowsOf = (entryId: string) =>
  env.DB.batch(
    [
      'SELECT document, digest, frequency_order, built_at FROM public_entries WHERE entry_id = ?1',
      'SELECT pos, cefr FROM public_meanings WHERE entry_id = ?1 ORDER BY pos',
      'SELECT form, type, pos FROM public_forms WHERE entry_id = ?1 ORDER BY form, type, pos',
      'SELECT topic_id, sense_id, pos, cefr, level_order, frequency_order, summary FROM public_sense_topics WHERE entry_id = ?1 ORDER BY topic_id, sense_id',
      'SELECT form, role FROM public_morphemes WHERE entry_id = ?1 ORDER BY form, role',
      'SELECT field, scope, body FROM public_search WHERE entry_id = ?1 ORDER BY field, scope, body',
      'SELECT revision, view_revision FROM worklist WHERE entry_id = ?1',
    ].map((statement) => env.DB.prepare(statement).bind(entryId)),
  ).then((results) => results.map((result) => result.results))
const staleViews = async () =>
  (await env.DB.prepare('SELECT count(*) AS n FROM worklist WHERE revision <> view_revision').first<{ n: number }>())?.n

describe('public view', () => {
  afterEach(() => vi.restoreAllMocks())

  it('moves a phrase in and out of every public read as its headword lists and drops it [spec: public-view/publish]', async () => {
    const token = await issueAgentKey()
    const give = await headword('give', [{ pos: 'verb', gloss: 'To hand something to someone.' }])
    const list = await curated('phrases', give.entryId, {
      phrases: [
        { type: 'phrasal_verb', text: 'give up' },
        { type: 'phrasal_verb', text: 'give in' },
      ],
    })
    const giveUp = (await managed('give up')).entry.id
    const { senses } = await publishInventory(giveUp, [{ pos: 'verb', gloss: 'To stop trying to do something.' }])
    const sense = senses[0] as SenseId
    await submitOk(token, 'form', giveUp, { form: 'gave up', type: 'past' })
    await submitOk(token, 'topic', sense, { topic_id: 'family-and-relationships' })
    expect(await tagged()).toEqual([])
    stubReviewers()
    await deliverPendingReviews()

    expect((await call('/v1/entries/give%20up')).status).toBe(200)
    expect((await call(`/v1/senses/${sense}`)).status).toBe(200)
    expect(formLookupSchema.parse((await call('/v1/forms/gave%20up')).body).items).toEqual([
      expect.objectContaining({ lemma: 'give up', matches: [{ type: 'past', pos: 'verb' }] }),
    ])
    expect(await listed()).toEqual(['give', 'give up'])
    expect(await tagged()).toEqual([sense])
    expect(await staleViews()).toBe(0)

    await curated('phrases', give.entryId, { phrases: [{ type: 'phrasal_verb', text: 'give in' }] }, list.id)
    expect((await call('/v1/entries/give%20up')).status).toBe(404)
    expect((await call(`/v1/senses/${sense}`)).status).toBe(404)
    expect((await call('/v1/forms/gave%20up')).status).toBe(404)
    expect(await listed()).toEqual(['give'])
    expect(await tagged()).toEqual([])
    const rows = await env.DB.prepare(
      "SELECT (SELECT count(*) FROM public_entries WHERE entry_id = ?1) + (SELECT count(*) FROM public_forms WHERE entry_id = ?1) + (SELECT count(*) FROM public_sense_topics WHERE entry_id = ?1) + (SELECT count(*) FROM public_morphemes WHERE entry_id = ?1) + (SELECT count(*) FROM public_meanings WHERE entry_id = ?1) + (SELECT count(*) FROM public_search WHERE entry_id = ?1) + (SELECT count(*) FROM public_search_fts WHERE public_search_fts MATCH 'trying') AS n",
    )
      .bind(giveUp)
      .first<{ n: number }>()
    expect(rows?.n).toBe(0)
  })

  it('updates the linked entry when the other end of its relation changes [spec: public-view/linked]', async () => {
    const { shore, coast } = await seedBank()
    const relatedGloss = async () =>
      (await entryOf('bank')).meanings[0]?.senses[0]?.relations.synonyms.map((related) => related.gloss)
    expect(await relatedGloss()).toEqual(['Land along water.'])

    const reworded = await publishInventory(
      shore.entryId,
      [{ id: coast, pos: 'noun', gloss: 'The land along the edge of the sea.' }],
      shore.inventory.id,
    )
    // No read has rebuilt it: the write's own refresh did.
    expect(await staleViews()).toBe(0)
    expect(await relatedGloss()).toEqual(['The land along the edge of the sea.'])

    await publishInventory(
      shore.entryId,
      [{ pos: 'verb', gloss: 'To support something with props.' }],
      reworded.fact.id,
    )
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
    const { bank, river, form, submit } = await seedBank()
    for (const path of ['/v1/entries/bank', `/v1/senses/${river}`, '/v1/forms/banks']) {
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
    for (const path of ['/v1/entries', '/v1/topics/people/senses']) {
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
      json: { target_type: 'fact', target_id: form.id, message: 'Too vague.' },
    })
    const revision = await env.DB.prepare('SELECT revision, view_revision FROM worklist WHERE entry_id = ?')
      .bind(bank.entryId)
      .first<{ revision: number; view_revision: number }>()
    expect(revision?.view_revision).toBe(revision?.revision)
    expect(await etag()).toBe(before)
    await submit('example', river, { text: 'We sat on the bank.' })
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
        'DELETE FROM public_morphemes',
        'DELETE FROM public_meanings',
        'DELETE FROM public_search',
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
    await submit('morphology', bank.entryId, { parts: [{ form: 'bank', role: 'base' }] })
    await deliverPendingReviews()
    const { publicViews } = createDeps(env)
    const built = await viewRowsOf(bank.entryId)
    const [documentRow] = built[0] as Array<{ document: string }>
    if (!documentRow) throw new Error('bank has no stored document.')
    const document = readStored<StoredEntry>(documentRow.document)
    expect(built[1]).toHaveLength(1)
    expect(built[2]).toHaveLength(1)
    expect(built[3]).toHaveLength(1)
    expect(built[4]).toHaveLength(1)
    expect(built[5]).toHaveLength(1)

    // A rebuild loads the stale revision, then another write bumps it before the rebuild saves.
    await env.DB.prepare('UPDATE worklist SET revision = revision + 1 WHERE entry_id = ?').bind(bank.entryId).run()
    const [stale] = await publicViews.listStale([bank.entryId])
    if (!stale) throw new Error('bank is not stale.')
    await env.DB.prepare('UPDATE worklist SET revision = revision + 1 WHERE entry_id = ?').bind(bank.entryId).run()
    const moved = await viewRowsOf(bank.entryId)

    await publicViews.save(
      stale,
      publicViewRecord({ ...document, lemma: 'bank up', meanings: [], morphology: null, frequency: null }, new Map()),
    )
    expect(await viewRowsOf(bank.entryId)).toEqual(moved)
    await publicViews.save(stale, null)
    expect(await viewRowsOf(bank.entryId)).toEqual(moved)
    expect(moved.slice(0, 6)).toEqual(built.slice(0, 6))
  })

  it('finds forms and list rows only once the drain has built them [spec: public-view/drain]', async () => {
    const { bank, river } = await seedBank()
    // What a migration that marks views stale leaves, as public_view_backfill does.
    await env.DB.batch(
      [
        'UPDATE worklist SET view_revision = revision - 1',
        'DELETE FROM public_forms',
        'DELETE FROM public_sense_topics',
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
    expect(await tagged()).toEqual([river])
    expect(bank.senses).toEqual([river])
  })

  it('serves every variant as the live projection builds it [spec: public-view/parity]', async () => {
    await importLearnerData({ zipf: { bank: 5.1, shore: 4 }, levels: { bank: 'A1' } })
    const { river, coast, submit } = await seedBank()
    await submit('translation', river, { language: 'zh', of: 'sense', text: '河岸' })
    await deliverPendingReviews()
    const deps = createDeps(env)
    const topicNames = await topicNamesOf(deps)
    const categories = topicCategories(await deps.topics.list())
    const variants: Array<[string, ReadVariant]> = [
      ['', { lang: null, review: false }],
      ['?lang=zh', { lang: 'zh', review: false }],
      ['?lang=all&include=review', { lang: 'all', review: true }],
    ]
    for (const [lemma, senseId] of [
      ['bank', river],
      ['shore', coast],
    ] as Array<[Lemma, SenseId]>) {
      const entry = await deps.nodes.findEntryByLemma(lemma)
      if (!entry) throw new Error(`No entry ${lemma}.`)
      const snapshot = await deps.nodes.loadEntrySnapshot(entry)
      const live = projectPublicEntry(snapshot, { reference: await deps.reference.forLemma(lemma), topicNames })
      const found = await deps.publicViews.findByLemma(lemma)
      if (!live || !found) throw new Error(`${lemma} is not public.`)
      for (const [query, variant] of variants) {
        expect(await (await request(`/v1/entries/${lemma}${query}`)).json()).toEqual(
          shapeEntry(live, found.links, env.MEDIA_BASE_URL, variant, categories),
        )
        expect(await (await request(`/v1/senses/${senseId}${query}`)).json()).toEqual(
          shapeSenseDetail(live, senseId, env.MEDIA_BASE_URL, variant, categories),
        )
      }
    }
  })

  it('resolves every published form of a public entry through the form lookup, shown or not [spec: public-view/form-parity]', async () => {
    const { bank, submit } = await seedBank()
    // bank has only a noun sense: the verb forms and the pronoun plural have no meaning to show them.
    await submit('form', bank.entryId, { form: 'banked', type: 'past' })
    await submit('form', bank.entryId, { form: 'banking', type: 'present_participle', pos: 'verb' })
    await submit('form', bank.entryId, { form: 'banken', type: 'plural', pos: 'pronoun' })
    await submit('form', bank.entryId, { form: 'banc', type: 'variant' })
    await deliverPendingReviews()

    const shown = (await entryOf('bank')).meanings.flatMap((meaning) => Object.values(meaning.forms).flat())
    expect(shown).toEqual([{ form: 'banks', irregular: false }])
    const { results } = await env.DB.prepare(
      `SELECT entries.lemma, json_extract(facts.payload, '$.form') AS form, json_extract(facts.payload, '$.type') AS type
       FROM facts JOIN entries ON entries.id = facts.subject_id JOIN public_entries ON public_entries.entry_id = entries.id
       WHERE facts.kind = 'form' AND facts.status = 'published' ORDER BY form`,
    ).all<{ lemma: string; form: string; type: string }>()
    expect(results.map((row) => row.form)).toEqual(['banc', 'banked', 'banken', 'banking', 'banks'])
    for (const row of results) {
      const found = formLookupSchema.parse((await call(`/v1/forms/${row.form}`)).body).items
      expect(found).toEqual([
        expect.objectContaining({ lemma: row.lemma, matches: [expect.objectContaining({ type: row.type })] }),
      ])
    }
    expect(formLookupSchema.parse((await call('/v1/forms/banking')).body).items[0]?.matches).toEqual([
      { type: 'present_participle', pos: 'verb' },
    ])
    expect(formLookupSchema.parse((await call('/v1/forms/banked')).body).items[0]?.matches).toEqual([{ type: 'past' }])
  })

  it('lists the public phrases a headword names, in its list order, joined on read [spec: public-view/phrases]', async () => {
    const give = await headword('give', [{ pos: 'verb', gloss: 'To hand something to someone.' }])
    const etagOf = async (lemma: string) => (await request(`/v1/entries/${lemma}`)).headers.get('etag')
    expect((await entryOf('give')).phrases.phrasal_verbs).toEqual([])
    const list = await curated('phrases', give.entryId, {
      phrases: [
        { type: 'phrasal_verb', text: 'give up' },
        { type: 'phrasal_verb', text: 'give in' },
      ],
    })
    const listedEtag = await etagOf('give')
    // Neither phrase is public before its inventory publishes.
    expect((await entryOf('give')).phrases.phrasal_verbs).toEqual([])

    await publishInventory((await managed('give up')).entry.id, [{ pos: 'verb', gloss: 'To stop trying.' }])
    expect((await entryOf('give')).phrases.phrasal_verbs).toEqual([
      { lemma: 'give up', pos: ['verb'], cefr: null, cefr_source: null, gloss: 'To stop trying.', image_url: null },
    ])
    const shownEtag = await etagOf('give')
    expect(shownEtag).not.toBe(listedEtag)
    expect(await staleViews()).toBe(0)

    await publishInventory((await managed('give in')).entry.id, [{ pos: 'verb', gloss: 'To accept defeat.' }])
    // A public phrase containing the word that the list does not name is not one of its phrases.
    await headword('give way', [{ pos: 'verb', gloss: 'To break under pressure.' }])
    expect((await entryOf('give')).phrases.phrasal_verbs.map((phrase) => phrase.lemma)).toEqual(['give up', 'give in'])

    await curated('phrases', give.entryId, { phrases: [{ type: 'phrasal_verb', text: 'give in' }] }, list.id)
    expect((await entryOf('give')).phrases.phrasal_verbs.map((phrase) => phrase.lemma)).toEqual(['give in'])
    expect(await etagOf('give')).not.toBe(shownEtag)
  })

  it('lists the entries sharing a base as word family and links the public parts [spec: public-view/family]', async () => {
    const { submit } = await seedBank()
    const happy = await headword('happy', [{ pos: 'noun', gloss: 'Feeling or showing pleasure.' }])
    const happiness = await headword('happiness', [{ pos: 'noun', gloss: 'The state of being happy.' }])
    await submit('morphology', happy.entryId, { parts: [{ form: 'happy', role: 'base' }] })
    const formation = await submit('morphology', happiness.entryId, {
      parts: [
        { form: 'happy', role: 'base' },
        { form: '-ness', role: 'suffix' },
      ],
    })
    await deliverPendingReviews()

    const morphologyOf = async (lemma: string) => (await entryOf(lemma)).morphology
    expect(await morphologyOf('happiness')).toEqual({
      parts: [
        { form: 'happy', role: 'base', lemma: 'happy' },
        { form: '-ness', role: 'suffix' },
      ],
      family: [
        {
          lemma: 'happy',
          pos: ['noun'],
          cefr: null,
          cefr_source: null,
          gloss: 'Feeling or showing pleasure.',
          image_url: null,
        },
      ],
    })
    expect((await morphologyOf('happy'))?.family.map((member) => member.lemma)).toEqual(['happiness'])

    await submit(
      'morphology',
      happiness.entryId,
      {
        parts: [
          { form: 'happi', role: 'base' },
          { form: '-ness', role: 'suffix' },
        ],
      },
      formation.id,
    )
    await deliverPendingReviews()
    expect((await morphologyOf('happiness'))?.family).toEqual([])
    expect((await morphologyOf('happy'))?.family).toEqual([])
  })

  it('reads translations and topic names in the language asked for, with an ETag per language [spec: public-view/language]', async () => {
    const { bank, river, submit } = await seedBank()
    await submit('translation', river, { language: 'zh', of: 'sense', text: '河岸' })
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
    expect(zh.sense?.topics).toEqual([
      {
        id: 'family-and-relationships',
        name: { en: 'Family and relationships', zh: '家庭与关系' },
        category: { id: 'people', name: { en: 'People', zh: '人物' } },
      },
    ])
    expect((await read('?lang=zh')).etag).toBe(zh.etag)

    // The response names the stored language it used, so a regional tag reads and reports zh.
    const header = await read('', { 'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8' })
    expect(header.body.lang).toBe('zh')
    expect(header.sense?.translations).toEqual(['河岸'])
    expect(header.etag).toBe(zh.etag)

    // Stored zh is Simplified: a Traditional request reads no language rather than Simplified text.
    const traditional = await read('?lang=zh-TW', { 'accept-language': 'zh' })
    expect(traditional.body.lang).toBeNull()
    expect(traditional.sense).not.toHaveProperty('translations')
    expect(traditional.sense?.topics[0]?.name).toEqual({ en: expect.any(String) })
    expect(traditional.sense?.topics[0]?.category?.name).toEqual({ en: 'People' })
    expect((await read('', { 'accept-language': 'zh-Hant,en;q=0.5' })).body.lang).toBeNull()

    const all = await read('?lang=ALL')
    expect(all.body.lang).toBe('all')
    expect(all.sense?.translations).toEqual({ zh: ['河岸'] })

    const none = await read('')
    expect(none.body.lang).toBeNull()
    expect(none.sense).not.toHaveProperty('translations')
    expect(none.etag).toBe(traditional.etag)
    expect(new Set([zh.etag, all.etag, none.etag]).size).toBe(3)

    const plain = JSON.stringify(none.body)
    expect(plain).not.toContain('"review"')
    expect(plain).not.toContain('fact_id')
    const reviewed = await read('?include=review')
    expect(reviewed.body.review?.inventory.fact_id).toBe(bank.inventory.id)
    expect(reviewed.sense?.review?.gloss.fact_id).toBe(bank.inventory.id)
    expect(reviewed.etag).not.toBe(none.etag)

    const summary = entryPageSchema.parse((await call('/v1/entries?lang=zh')).body)
    expect(summary.lang).toBe('zh')
    expect(summary.items[0]).toEqual({
      lemma: 'bank',
      pos: ['noun'],
      cefr: null,
      cefr_source: null,
      gloss: 'Land beside a river.',
      image_url: null,
      translation: '河岸',
    })
    const sense = publicSenseDetailSchema.parse((await call(`/v1/senses/${river}?lang=zh`)).body)
    expect(sense).toMatchObject({ lang: 'zh', pos: 'noun', translations: ['河岸'], entry: { translation: '河岸' } })
    for (const path of [`/v1/senses/${river}`, '/v1/forms/banks']) {
      expect((await request(path)).headers.get('vary')).toBe('Accept-Language')
    }
    const invalid = await call('/v1/entries/bank?lang=not_a_tag')
    expect(invalid.status).toBe(400)
    expect(invalid.body).toMatchObject({ error: { code: 'invalid_request' } })
  })

  it('rejects lang=all on every list, so each summary has one shape [spec: public-view/list-language]', async () => {
    await seedBank()
    for (const path of [
      '/v1/entries?lang=all',
      '/v1/forms/banks?lang=All',
      '/v1/topics/family-and-relationships/senses?lang=all',
    ]) {
      const rejected = await call(path)
      expect(rejected.status).toBe(400)
      expect(rejected.body).toMatchObject({
        error: { code: 'invalid_request', message: expect.stringContaining('lang=all') },
      })
    }
    expect((await call('/v1/entries?lang=zh')).status).toBe(200)
  })
})
