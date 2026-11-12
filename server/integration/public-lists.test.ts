import { env } from 'cloudflare:test'
import { entryListStatement, searchStatement, taggedSenseStatement } from '@server/adapters/repos/public-view'
import { createDb } from '@server/db/client'
import { entryPageSchema, searchPageSchema } from '@shared/catalog'
import type { TopicId } from '@shared/facts'
import { topicSensePageSchema } from '@shared/topics'
import type { SQL } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  call,
  deliverPendingReviews,
  headword,
  importLearnerData,
  issueAgentKey,
  request,
  stubReviewers,
  submitOk,
} from './helpers'

/**
 * bank (A1 noun, also a verb), river (A1 noun), banker (B2 noun), and money (no level or
 * frequency), with Chinese translations, examples, and family tags; all published.
 */
async function seedWords() {
  await importLearnerData({
    zipf: { bank: 5.2, river: 4.9, banker: 3.6 },
    levels: { bank: 'A1', river: 'A1', banker: 'B2' },
  })
  const token = await issueAgentKey()
  const senses: Record<string, string> = {}
  const words = [
    ['bank', 'noun', 'An organization that keeps money for its customers.', '银行', 'She works at the bank.'],
    ['bank', 'verb', 'To put money into an account.', '存钱', null],
    ['river', 'noun', 'A large natural stream of water.', '河流', 'We sat on the bank of the river.'],
    ['banker', 'noun', 'A person who runs a bank.', '银行家', null],
    ['money', 'noun', 'What people earn and keep in a bank.', '钱', null],
  ] as const
  for (const lemma of new Set(words.map(([word]) => word))) {
    const own = words.filter(([word]) => word === lemma)
    const { senses: ids } = await headword(
      lemma,
      own.map(([, pos, gloss]) => ({ pos, gloss })),
    )
    for (const [at, [, pos, , translation, example]] of own.entries()) {
      const sense = ids[at] as string
      senses[`${lemma} ${pos}`] = sense
      await submitOk(token, 'translation', sense, { language: 'zh', of: 'sense', text: translation })
      if (example) await submitOk(token, 'example', sense, { text: example })
      if (pos === 'noun' && lemma !== 'money') await submitOk(token, 'topic', sense, { topic_id: 'family' })
    }
  }
  stubReviewers()
  await deliverPendingReviews()
  return senses
}

const lemmas = async (path: string) => entryPageSchema.parse((await call(path)).body).items.map((item) => item.lemma)

/** Every page of a list, following next_cursor. */
async function allPages(path: string): Promise<string[]> {
  const seen: string[] = []
  let cursor: string | null = null
  do {
    const separator = path.includes('?') ? '&' : '?'
    const { body } = await call(`${path}${separator}limit=1${cursor ? `&cursor=${cursor}` : ''}`)
    const parsed: { items: Array<{ lemma: string; sense_id?: string }>; next_cursor: string | null } = body as never
    seen.push(...parsed.items.map((item) => item.sense_id ?? item.lemma))
    cursor = parsed.next_cursor
  } while (cursor)
  return seen
}

async function planOf(statement: SQL | { toSQL(): { sql: string; params: unknown[] } }) {
  const { sql, params } = 'toSQL' in statement ? statement.toSQL() : new SQLiteSyncDialect().sqlToQuery(statement)
  const { results } = await env.DB.prepare(`explain query plan ${sql}`)
    .bind(...params)
    .all<{ detail: string }>()
  return results.map((row) => row.detail)
}

describe('public lists and search', () => {
  afterEach(() => vi.restoreAllMocks())

  it('filters entries by level, part of speech, and topic, sorted by lemma or frequency, across pages [spec: public-view/list-filters]', async () => {
    await seedWords()
    expect(await lemmas('/v1/entries')).toEqual(['bank', 'banker', 'money', 'river'])
    expect(await lemmas('/v1/entries?sort=frequency')).toEqual(['bank', 'river', 'banker', 'money'])
    expect(await allPages('/v1/entries?sort=frequency')).toEqual(['bank', 'river', 'banker', 'money'])
    expect(await allPages('/v1/entries?level=A1&pos=noun&sort=frequency')).toEqual(['bank', 'river'])
    expect(await lemmas('/v1/entries?level=A1,B2')).toEqual(['bank', 'banker', 'river'])
    expect(await lemmas('/v1/entries?level=A1&level=B2&prefix=ban')).toEqual(['bank', 'banker'])
    expect(await lemmas('/v1/entries?pos=verb')).toEqual(['bank'])
    // The verb meaning has no level, so no one meaning is both.
    expect(await lemmas('/v1/entries?pos=verb&level=A1')).toEqual([])
    expect(await lemmas('/v1/entries?topic=family')).toEqual(['bank', 'banker', 'river'])
    expect(await allPages('/v1/entries?topic=people-feelings&level=A1&sort=frequency')).toEqual(['bank', 'river'])
    expect(await lemmas('/v1/entries?topic=family&pos=verb')).toEqual([])

    const lemmaCursor = entryPageSchema.parse((await call('/v1/entries?limit=1')).body).next_cursor
    expect((await call(`/v1/entries?sort=frequency&cursor=${lemmaCursor}`)).status).toBe(400)
    expect((await call('/v1/entries?level=a1')).status).toBe(400)
    expect((await call('/v1/entries?sort=zipf')).status).toBe(400)
    expect((await call('/v1/entries?topic=no-such-topic')).status).toBe(404)
  })

  it('sorts the senses of a topic by lemma, frequency, or level, across pages [spec: public-view/topic-sort]', async () => {
    const senses = await seedWords()
    const ids = (...keys: string[]) => keys.map((key) => senses[key])
    const page = async (sort: string) =>
      topicSensePageSchema
        .parse((await call(`/v1/topics/family/senses?sort=${sort}`)).body)
        .items.map((item) => item.sense_id)
    expect(await page('lemma')).toEqual(ids('bank noun', 'banker noun', 'river noun'))
    expect(await page('frequency')).toEqual(ids('bank noun', 'river noun', 'banker noun'))
    expect(await page('level')).toEqual(ids('bank noun', 'river noun', 'banker noun'))
    for (const sort of ['lemma', 'frequency', 'level']) {
      expect(await allPages(`/v1/topics/people-feelings/senses?sort=${sort}`)).toEqual(await page(sort))
    }
    expect((await call('/v1/topics/family/senses?sort=zipf')).status).toBe(400)
  })

  it('ranks the exact lemma, lemma prefixes, glosses, translations, then examples, each entry once [spec: search/rank]', async () => {
    await seedWords()
    const hits = async (query: string, init?: RequestInit) => {
      const response = await request(`/v1/search?${query}`, init)
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=5')
      expect(response.headers.get('Vary')).toBe('Accept-Language')
      return searchPageSchema.parse(await response.json())
    }
    const bank = await hits('q=bank&lang=zh')
    expect(bank.lang).toBe('zh')
    expect(bank.items.map(({ lemma, match }) => [lemma, match])).toEqual([
      ['bank', 'lemma'],
      ['banker', 'lemma'],
      ['money', 'gloss'],
      ['river', 'example'],
    ])
    expect(bank.items[0]).toEqual({
      lemma: 'bank',
      pos: ['noun', 'verb'],
      cefr: 'A1',
      gloss: 'An organization that keeps money for its customers.',
      translation: '银行',
      match: 'lemma',
    })
    expect(await allPages('/v1/search?q=bank')).toEqual(['bank', 'banker', 'money', 'river'])
    // Case folds in text, never in the lemma; nothing is corrected or stemmed.
    expect((await hits('q=BANK')).items.map(({ lemma, match }) => [lemma, match])).toEqual([
      ['banker', 'gloss'],
      ['money', 'gloss'],
      ['bank', 'example'],
      ['river', 'example'],
    ])
    expect((await hits('q=bnak')).items).toEqual([])
    expect((await hits('q=banks')).items).toEqual([])
    expect((await call('/v1/search?q=bank&lang=all')).status).toBe(400)
    expect((await call('/v1/search?q=%20')).status).toBe(400)
  })

  it('finds the main entry by its spelling variant, as the exact lemma [spec: search/variant]', async () => {
    const token = await issueAgentKey()
    const colour = await headword('colour', [{ pos: 'noun', gloss: 'The quality of red, blue, or green.' }])
    await submitOk(token, 'form', colour.entryId, { form: 'color', type: 'variant' })
    stubReviewers()
    await deliverPendingReviews()
    const found = searchPageSchema.parse((await call('/v1/search?q=color')).body)
    expect(found.items.map(({ lemma, match }) => [lemma, match])).toEqual([['colour', 'lemma']])
    expect((await call('/v1/forms/color')).body).toMatchObject({
      items: [{ lemma: 'colour', matches: [{ type: 'variant' }] }],
    })
    expect((await call('/v1/entries/color')).status).toBe(404)
  })

  it('finds Chinese words in translations of the requested language only [spec: search/chinese]', async () => {
    await seedWords()
    const found = async (query: string, init?: RequestInit, params = '') =>
      searchPageSchema
        .parse((await call(`/v1/search?q=${encodeURIComponent(query)}${params}`, init)).body)
        .items.map(({ lemma, match }) => [lemma, match])
    expect(await found('银行', { headers: { 'accept-language': 'zh-CN' } })).toEqual([
      ['bank', 'translation'],
      ['banker', 'translation'],
    ])
    expect(await found('银行', {}, '&lang=zh-Hans')).toEqual([
      ['bank', 'translation'],
      ['banker', 'translation'],
    ])
    expect(await found('银行家', {}, '&lang=zh')).toEqual([['banker', 'translation']])
    expect(await found('钱', { headers: { 'accept-language': 'zh' } })).toEqual([
      ['bank', 'translation'],
      ['money', 'translation'],
    ])
    // A Chinese query reads no other language or script.
    expect(await found('银行')).toEqual([])
    expect(await found('银行', { headers: { 'accept-language': 'zh-TW' } })).toEqual([])
  })

  it('serves every list and search through indexes [spec: public-view/list-indexes]', async () => {
    await seedWords()
    const db = createDb(env)
    const page = { limit: 20 }
    const plans = {
      byFrequency: await planOf(
        entryListStatement(db, { prefix: '', levels: ['A1'], pos: 'noun', leaves: null }, 'frequency', page),
      ),
      byTopic: await planOf(
        entryListStatement(db, { prefix: 'b', levels: [], pos: null, leaves: ['family' as TopicId] }, 'lemma', page),
      ),
      senses: await planOf(taggedSenseStatement(db, ['family' as TopicId], 'level', page)),
      search: await planOf(searchStatement({ text: 'bank', terms: ['bank'], scopes: ['en', 'zh'] }, page)),
    }
    console.info(`public list query plans:\n${JSON.stringify(plans, null, 2)}`)
    for (const plan of Object.values(plans)) {
      expect(plan.filter((step) => step.startsWith('SCAN public_') && !step.includes(' INDEX '))).toEqual([])
    }
    expect(plans.byFrequency[0]).toBe('SCAN public_entries USING INDEX public_entries_frequency_idx')
    expect(plans.byFrequency).toContain(
      'SEARCH public_meanings USING INDEX sqlite_autoindex_public_meanings_1 (entry_id=? AND pos=?)',
    )
    expect(plans.byTopic[0]).toBe('SEARCH public_entries USING INDEX public_entries_lemma_unique (lemma>? AND lemma<?)')
    expect(plans.byTopic).toContain(
      'SEARCH public_sense_topics USING COVERING INDEX public_sense_topics_entry_idx (entry_id=? AND rare=? AND topic_id=?)',
    )
    expect(plans.senses).toEqual(['SEARCH public_sense_topics USING INDEX public_sense_topics_level_idx (topic_id=?)'])
    expect(plans.search.some((step) => step.includes('VIRTUAL TABLE INDEX'))).toBe(true)
  })

  it('limits public reads per client address with 429 and Retry-After [spec: public-view/rate-limit]', async () => {
    await seedWords()
    const allowed = new Set(['203.0.113.1'])
    const READ_RATE_LIMITER = { limit: async ({ key }: { key: string }) => ({ success: allowed.has(key) }) }
    const read = (client: string, path = '/v1/entries/bank') =>
      request(path, { headers: { 'cf-connecting-ip': client }, bindings: { READ_RATE_LIMITER } })
    expect((await read('203.0.113.1')).status).toBe(200)
    const limited = await read('203.0.113.2')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('60')
    expect(await limited.json()).toMatchObject({ error: { code: 'rate_limited' } })
    expect((await read('203.0.113.2', '/v1/search?q=bank')).status).toBe(429)
  })
})
