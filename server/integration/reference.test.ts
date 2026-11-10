import { env } from 'cloudflare:test'
import { referenceImportSql } from '@server/adapters/reference-sql'
import type { CefrRow } from '@server/domain/reference'
import type { Lemma } from '@server/domain/term'
import { createEntryResultSchema, entryPageSchema, managedEntryDetailSchema, publicEntrySchema } from '@shared/catalog'
import { type ReferenceSource, referenceSourceListSchema } from '@shared/reference'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminToken, call, deliverPendingReviews, importReference, issueAgentKey, stubReviewers } from './helpers'

const source = (id: string, name: string): ReferenceSource => ({
  id,
  name,
  version: '1.0',
  license: 'CC BY-SA 4.0',
  license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  changes: 'Filtered by Vocnet.',
  attribution: `${name} by O'Brien et al.`,
  url: `https://example.test/${id}`,
  retrieved_at: '2026-11-09',
})

const lemma = (raw: string) => raw as Lemma
const cefr = (raw: string, pos: CefrRow['pos'], level: CefrRow['level'], sourceId: string): CefrRow => ({
  lemma: lemma(raw),
  pos,
  level,
  sourceId,
})

const fixture = {
  sources: [source('freq', 'Frequency list'), source('profile-a', 'Profile A'), source('profile-b', 'Profile B')],
  frequency: {
    sourceId: 'freq',
    rows: [{ word: 'bank', zipf: 5.16, rank: 691 }],
  },
  cefr: [
    cefr('bank', 'noun', 'A1', 'profile-a'),
    cefr('bank', 'verb', 'C1', 'profile-b'),
    cefr('Bank', 'noun', 'C2', 'profile-b'),
  ],
}

/** Publishes each entry with a sense of each part of speech, so its meanings show their CEFR levels. */
async function publishEntries(entries: Record<string, Array<CefrRow['pos']>>) {
  const token = await issueAgentKey()
  for (const [value, kinds] of Object.entries(entries)) {
    const { entry } = createEntryResultSchema.parse(
      (await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: value } })).body,
    )
    for (const pos of kinds) {
      const gloss = `A ${pos} sense of ${value}.`
      await call('/manage/v1/senses', { method: 'POST', token, json: { entry_id: entry.id, pos, gloss } })
    }
  }
  stubReviewers()
  await deliverPendingReviews()
  return token
}

describe('reference data', () => {
  afterEach(() => vi.restoreAllMocks())

  it('joins CEFR by exact lemma and frequency by word form into entries [spec: reference/entry-read]', async () => {
    await importReference(fixture)
    const token = await publishEntries({ bank: ['noun', 'verb'], Bank: ['noun'], shore: ['noun'] })

    const managedBank = await call('/manage/v1/entries/bank', { token })
    expect(managedEntryDetailSchema.parse(managedBank.body)).toMatchObject({
      frequency: { zipf: 5.16, rank: 691, source_id: 'freq' },
      cefr: [
        { pos: 'noun', level: 'A1', source_id: 'profile-a' },
        { pos: 'verb', level: 'C1', source_id: 'profile-b' },
      ],
    })
    const levels = async (lemma: string) => {
      const entry = publicEntrySchema.parse((await call(`/v1/entries/${lemma}`)).body)
      return { frequency: entry.frequency, cefr: entry.meanings.map((meaning) => [meaning.pos, meaning.cefr]) }
    }
    expect(await levels('bank')).toEqual({
      frequency: { zipf: 5.16, rank: 691 },
      cefr: [
        ['noun', 'A1'],
        ['verb', 'C1'],
      ],
    })
    expect(await levels('Bank')).toEqual({ frequency: { zipf: 5.16, rank: 691 }, cefr: [['noun', 'C2']] })
    expect(await levels('shore')).toEqual({ frequency: null, cefr: [['noun', null]] })
    const summaries = entryPageSchema.parse((await call('/v1/entries')).body).items
    expect(summaries.map((summary) => [summary.lemma, summary.cefr])).toEqual([
      ['Bank', 'C2'],
      ['bank', 'A1'],
      ['shore', null],
    ])
    expect((await call('/v1/entries/BANK')).status).toBe(404)
  })

  it('lists every source with its license and attribution [spec: reference/sources]', async () => {
    await importReference(fixture)
    const expected = { items: [...fixture.sources].sort((a, b) => a.id.localeCompare(b.id)) }

    const open = await call('/v1/sources')
    expect(open.status).toBe(200)
    expect(referenceSourceListSchema.parse(open.body)).toEqual(expected)
    const managed = await call('/manage/v1/sources', { token: await adminToken() })
    expect(referenceSourceListSchema.parse(managed.body)).toEqual(expected)
  })

  it('replaces all reference data on every import [spec: reference/import-idempotent]', async () => {
    await importReference(fixture)
    await importReference(fixture)
    const count = async (table: string) =>
      (await env.DB.prepare(`select count(*) as n from ${table}`).first<{ n: number }>())?.n
    expect([await count('word_frequency'), await count('lemma_cefr'), await count('reference_sources')]).toEqual([
      1, 3, 3,
    ])

    await importReference({
      sources: [{ ...fixture.sources[0], version: '2.0' } as ReferenceSource, fixture.sources[1] as ReferenceSource],
      frequency: { sourceId: 'freq', rows: [{ word: 'bank', zipf: 5.2, rank: 680 }] },
      cefr: [cefr('bank', 'noun', 'A2', 'profile-a')],
    })
    await publishEntries({ bank: ['noun', 'verb'] })
    const bank = publicEntrySchema.parse((await call('/v1/entries/bank')).body)
    expect(bank.frequency).toEqual({ zipf: 5.2, rank: 680 })
    expect(bank.meanings.map((meaning) => [meaning.pos, meaning.cefr])).toEqual([
      ['noun', 'A2'],
      ['verb', null],
    ])
    const sources = referenceSourceListSchema.parse((await call('/v1/sources')).body)
    expect(sources.items.map(({ id, version }) => `${id}@${version}`)).toEqual(['freq@2.0', 'profile-a@1.0'])
  })

  it('refuses rows that name a source the import does not carry', () => {
    expect(() => referenceImportSql({ ...fixture, sources: [fixture.sources[0] as ReferenceSource] })).toThrow(
      'Reference rows name the unknown source profile-a.',
    )
  })
})
