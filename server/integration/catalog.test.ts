import { env } from 'cloudflare:test'
import { entrySummaryStatements } from '@server/adapters/repos/nodes'
import { encodeCursor } from '@server/adapters/repos/rows'
import { createDb } from '@server/db/client'
import {
  entryPageSchema,
  entrySummaryPageSchema,
  formLookupSchema,
  managedEntrySchema,
  nodeLocationSchema,
  publicEntrySchema,
  publicSenseDetailSchema,
} from '@shared/catalog'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adminToken,
  admit,
  call,
  curated,
  headword,
  issueAgentKey,
  managed,
  publishInventory,
  reviewPending,
  submitInventory,
  submitOk,
} from './helpers'

/** "bank" and "shore", each with a published inventory, and a form, example, translations, and synonym under review. */
async function seedBank() {
  const token = await issueAgentKey()
  const bank = await headword('bank', [{ pos: 'noun', gloss: 'Land beside a river.' }])
  const shore = await headword('shore', [{ pos: 'noun', gloss: 'Land along water.' }])
  const river = bank.senses[0] as string
  const coast = shore.senses[0] as string
  const form = await submitOk(token, 'form', bank.entryId, { form: 'banks', type: 'plural' })
  const example = await submitOk(token, 'example', river, { text: 'We sat on the bank.' })
  const equivalent = await submitOk(token, 'translation', river, { language: 'zh', of: 'sense', text: '河岸' })
  const sentence = await submitOk(token, 'translation', example.object_id as string, {
    language: 'zh',
    of: 'sentence',
    text: '我们坐在河岸上。',
  })
  const relation = await submitOk(token, 'relation', river, { type: 'synonym', target_sense_id: coast })
  return { token, bank, river, coast, form, example, equivalent, sentence, relation }
}

describe('public catalog', () => {
  afterEach(() => vi.restoreAllMocks())

  it('serves a reviewed entry with forms, senses, examples, translations, and relations [spec: catalog/entry-read]', async () => {
    const { river, coast, bank, example } = await seedBank()
    await reviewPending()

    const { status, body } = await call('/v1/entries/bank?lang=zh')
    expect(status).toBe(200)
    const entry = publicEntrySchema.parse(body)
    // A synonym is stored once, from the smaller sense id; both senses list it.
    expect(entry.meanings).toEqual([
      {
        pos: 'noun',
        cefr: null,
        productive_use: null,
        skills: null,
        pronunciations: [],
        forms: { plural: [{ form: 'banks', irregular: false }] },
        senses: [
          expect.objectContaining({
            id: river,
            gloss: 'Land beside a river.',
            labels: [],
            rare: false,
            translations: ['河岸'],
            examples: [
              { sentence_id: example.object_id, text: 'We sat on the bank.', translation: '我们坐在河岸上。' },
            ],
            relations: expect.objectContaining({
              synonyms: [{ lemma: 'shore', sense_id: coast, gloss: 'Land along water.' }],
            }),
          }),
        ],
      },
    ])
    expect(JSON.stringify(entry)).not.toContain('confidence')

    const reviewed = publicEntrySchema.parse((await call('/v1/entries/bank?include=review')).body)
    expect(reviewed.review?.inventory).toEqual(
      expect.objectContaining({ fact_id: bank.inventory.id, verdict: 'pass', confidence: 1 }),
    )
    const [meaning] = reviewed.meanings
    expect(meaning?.review?.forms.plural).toEqual([expect.objectContaining({ verdict: 'pass', confidence: 0.93 })])
    expect(meaning?.senses[0]?.examples).toEqual([
      {
        sentence_id: example.object_id,
        text: 'We sat on the bank.',
        review: expect.objectContaining({ confidence: 0.88 }),
      },
    ])
    expect(meaning?.senses[0]?.relations.synonyms[0]?.review).toEqual(expect.objectContaining({ verdict: 'pass' }))

    const sense = publicSenseDetailSchema.parse((await call(`/v1/senses/${river}`)).body)
    expect(sense).toMatchObject({ id: river, pos: 'noun', entry: { lemma: 'bank', pos: ['noun'] } })
    const incoming = publicEntrySchema.parse((await call('/v1/entries/shore')).body)
    expect(incoming.meanings[0]?.senses[0]?.relations.synonyms).toEqual([
      { lemma: 'bank', sense_id: river, gloss: 'Land beside a river.' },
    ])
  })

  it('404s unknown, unlisted, and not-live lemmas, forms, and senses with no fallback [spec: catalog/entry-not-found]', async () => {
    const token = await issueAgentKey()
    const pending = await admit('bank')
    const inventory = await submitInventory(token, pending, [{ pos: 'noun', gloss: 'Land beside a river.' }])
    const [unlisted] = inventory.kind === 'senses' ? inventory.payload.senses : []
    await submitOk(token, 'form', pending, { form: 'banks', type: 'plural' })
    // "give in" is live while a published phrases list names it, and not once the list drops it.
    const give = await headword('give', [{ pos: 'verb', gloss: 'To hand something to someone.' }])
    const list = await curated('phrases', give.entryId, {
      phrases: [
        { type: 'phrasal_verb', text: 'give up' },
        { type: 'phrasal_verb', text: 'give in' },
      ],
    })
    const dropped = (await managed('give in')).entry.id
    await publishInventory(dropped, [{ pos: 'verb', gloss: 'To stop arguing and accept defeat.' }])
    expect((await call('/v1/entries/give%20in')).status).toBe(200)
    await curated('phrases', give.entryId, { phrases: [{ type: 'phrasal_verb', text: 'give up' }] }, list.id)

    for (const path of [
      '/v1/entries/bank',
      '/v1/entries/banks',
      '/v1/entries/Bank',
      '/v1/entries/nothing',
      '/v1/forms/banks',
      `/v1/senses/${unlisted?.id}`,
      `/v1/senses/${crypto.randomUUID()}`,
      '/v1/entries/give%20in',
    ]) {
      const { status, body } = await call(path)
      expect([path, status]).toEqual([path, 404])
      expect(apiErrorSchema.parse(body).error.code).toBe('not_found')
    }
  })

  it('looks up the entry an inflected form belongs to [spec: catalog/form-lookup-api]', async () => {
    await seedBank()
    await reviewPending()
    const lookup = formLookupSchema.parse((await call('/v1/forms/banks')).body)
    expect(lookup).toEqual({
      lang: null,
      items: [
        {
          lemma: 'bank',
          pos: ['noun'],
          cefr: null,
          gloss: 'Land beside a river.',
          image_url: null,
          matches: [{ type: 'plural', pos: 'noun' }],
        },
      ],
    })
    expect((await call('/v1/forms/bank')).status).toBe(404)
  })

  it('pages through published entries by prefix and rejects a broken cursor [spec: catalog/search]', async () => {
    for (const lemma of ['band', 'bank', 'bar', 'cat']) {
      await headword(lemma, [{ pos: 'noun', gloss: `A thing called ${lemma}.` }])
    }
    await admit('bat')

    const seen: string[] = []
    let cursor: string | null = null
    do {
      const query: string = cursor ? `&cursor=${cursor}` : ''
      const page = entryPageSchema.parse((await call(`/v1/entries?prefix=ba&limit=2${query}`)).body)
      seen.push(...page.items.map((item) => item.lemma))
      cursor = page.next_cursor
    } while (cursor)
    expect(seen).toEqual(['band', 'bank', 'bar'])

    const broken = await call('/v1/entries?cursor=broken')
    expect(broken.status).toBe(400)
    expect(apiErrorSchema.parse(broken.body).error.code).toBe('invalid_cursor')
  })

  it('shows management every fact in every status with its liveness and scores [spec: catalog/manage-entry]', async () => {
    const token = await issueAgentKey()
    const entryId = await admit('bank', 2)
    const inventory = await submitInventory(token, entryId, [{ pos: 'noun', gloss: 'Land beside a river.' }])
    await submitOk(token, 'form', entryId, { form: 'banks', type: 'plural' })
    await submitOk(token, 'syllables', entryId, { syllables: ['bank'] })

    const pending = managedEntrySchema.parse((await call('/manage/v1/entries/bank', { token })).body)
    expect(pending.facts.map((fact) => [fact.kind, fact.status]).sort()).toEqual([
      ['form', 'pending'],
      ['senses', 'pending'],
      ['syllables', 'pending'],
    ])
    expect(pending).toMatchObject({ live: true, batch: 2 })
    expect(pending.senses.map((sense) => sense.id)).toEqual(
      inventory.kind === 'senses' ? inventory.payload.senses.map((sense) => sense.id) : [],
    )

    await reviewPending()
    const [sense] = pending.senses
    const example = await submitOk(token, 'example', sense!.id, { text: 'We sat on the bank.' })
    await submitOk(token, 'translation', example.object_id as string, {
      language: 'zh',
      of: 'sentence',
      text: '我们坐在河岸上。',
    })
    const view = managedEntrySchema.parse((await call('/manage/v1/entries/bank', { token })).body)
    expect(view.facts.map((fact) => [fact.kind, fact.status]).sort()).toEqual([
      ['example', 'pending'],
      ['form', 'published'],
      ['senses', 'published'],
      ['syllables', 'published'],
      ['translation', 'pending'],
    ])
    expect(view.completeness).toBeGreaterThan(0)
    expect(view.completeness).toBeLessThan(1)
    expect(view.credibility).toBeGreaterThan(0)
    expect(view.slots.total).toBeGreaterThan(view.slots.published)
    expect(view.slots.pending).toBeGreaterThan(0)
  })

  it('lists entries in every status with their counts, page by page [spec: catalog/manage-entry-list]', async () => {
    const { token, bank, river, relation, form } = await seedBank()
    for (const lemma of ['band', 'bar', 'cat']) await admit(lemma)
    // "give back" exists but is not live: the phrases list that admitted it dropped it.
    const give = await headword('give', [{ pos: 'verb', gloss: 'To hand something to someone.' }])
    const list = await curated('phrases', give.entryId, {
      phrases: [
        { type: 'phrasal_verb', text: 'give up' },
        { type: 'phrasal_verb', text: 'give back' },
      ],
    })
    await curated('phrases', give.entryId, { phrases: [{ type: 'phrasal_verb', text: 'give up' }] }, list.id)
    await reviewPending()
    const example = await submitOk(token, 'example', river, { text: 'The bank flooded.' })
    await call(`/manage/v1/facts/${example.id}/retract`, { method: 'POST', token })
    await submitOk(token, 'example', river, { text: 'They walked along the bank.' })
    await env.DB.prepare('update worklist set last_worked_at = ? where entry_id = ?')
      .bind(new Date().toISOString(), bank.entryId)
      .run()

    expect((await call('/manage/v1/entries')).status).toBe(401)
    const pages = []
    let cursor: string | null = null
    do {
      const query: string = cursor ? `&cursor=${cursor}` : ''
      const page = entrySummaryPageSchema.parse(
        (await call(`/manage/v1/entries?prefix=ba&limit=2${query}`, { token })).body,
      )
      pages.push(page.items.map((item) => item.lemma))
      cursor = page.next_cursor
    } while (cursor)
    expect(pages).toEqual([['band', 'bank'], ['bar']])

    const [, summary] = entrySummaryPageSchema.parse((await call('/manage/v1/entries?prefix=ba', { token })).body).items
    // The synonym counts under whichever entry owns its subject sense; an example's translation is about the example.
    const own = relation.subject_id === river ? 1 : 0
    expect(form.status).toBe('pending')
    expect(summary).toMatchObject({
      lemma: 'bank',
      live: true,
      sense_count: 1,
      fact_counts: { pending: 1, published: 4 + own, rejected: 0, superseded: 0, retracted: 1 },
      last_worked_at: expect.any(String),
    })
    const all = entrySummaryPageSchema.parse((await call('/manage/v1/entries', { token: await adminToken() })).body)
    expect(all.items.map((item) => [item.lemma, item.live, item.sense_count])).toEqual([
      ['band', true, 0],
      ['bank', true, 1],
      ['bar', true, 0],
      ['cat', true, 0],
      ['give', true, 1],
      ['give back', false, 0],
      ['give up', true, 0],
      ['shore', true, 1],
    ])
    const broken = await call('/manage/v1/entries?cursor=broken', { token })
    expect([broken.status, apiErrorSchema.parse(broken.body).error.code]).toEqual([400, 'invalid_cursor'])
  })

  it('reads only the page when it lists entries [spec: catalog/manage-entry-list-index]', async () => {
    const cursor = encodeCursor({ lemma: 'ba' })
    const now = new Date().toISOString()
    const statements = [
      ...entrySummaryStatements(createDb(env), { prefix: 'b', level: null, stuck: false }, { limit: 50, cursor }, now),
      ...entrySummaryStatements(createDb(env), { prefix: 'b', level: 'A1', stuck: true }, { limit: 50, cursor }, now),
    ]
    const plans = await Promise.all(
      statements.map(async (statement) => {
        const { sql, params } = statement.toSQL()
        const { results } = await env.DB.prepare(`explain query plan ${sql}`)
          .bind(...params)
          .all<{ detail: string }>()
        return results.map((row) => row.detail)
      }),
    )
    console.info(`entry list query plans:\n${plans.map((plan) => plan.join('\n')).join('\n\n')}`)
    for (const plan of plans) {
      expect(plan.filter((step) => step.startsWith('SCAN'))).toEqual([])
      expect(plan.some((step) => step.includes('facts_live_content_idx'))).toBe(false)
    }
  })

  it('resolves an entry or sense id to its entry [spec: catalog/locate-node]', async () => {
    const { bank, river } = await seedBank()
    const token = await adminToken()
    const owner = { id: bank.entryId, lemma: 'bank' }
    const ofEntry = nodeLocationSchema.parse((await call(`/manage/v1/nodes/${bank.entryId}`, { token })).body)
    const ofSense = nodeLocationSchema.parse((await call(`/manage/v1/nodes/${river}`, { token })).body)
    expect(ofEntry).toEqual({ node_type: 'entry', entry: owner })
    expect(ofSense).toEqual({ node_type: 'sense', entry: owner })
    const missing = await call(`/manage/v1/nodes/${crypto.randomUUID()}`, { token })
    expect(missing.status).toBe(404)
  })
})
