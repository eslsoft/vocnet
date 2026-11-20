import { entryPageSchema, publicEntrySchema } from '@shared/catalog'
import { describe, expect, it } from 'vitest'
import { call, headword, issueAgentKey, submitOk } from './helpers'

describe('CEFR levels', () => {
  it('shows a curated level of a word the reference lists do not level, in the entry and its summary [spec: catalog/cefr-api]', async () => {
    const curator = await issueAgentKey('Curator', true)
    const asylum = await headword('asylum', [{ pos: 'noun', gloss: 'Protection a state gives a refugee.' }])
    const before = publicEntrySchema.parse((await call('/v1/entries/asylum')).body)
    expect([before.cefr, before.cefr_source]).toEqual([null, null])

    const fact = await submitOk(
      curator,
      'cefr',
      asylum.entryId,
      { level: 'C1' },
      { curation: { reason: 'The vocnet-v1 CEFR-C1 list.' } },
    )
    expect(fact).toMatchObject({ kind: 'cefr', status: 'published', review: { reviewer: 'curator' } })
    const entry = publicEntrySchema.parse((await call('/v1/entries/asylum?include=review')).body)
    expect([entry.cefr, entry.cefr_source, entry.meanings[0]?.cefr]).toEqual(['C1', 'curated', 'C1'])
    expect(entry.review?.cefr?.fact_id).toBe(fact.id)
    const list = entryPageSchema.parse((await call('/v1/entries?level=C1')).body)
    expect(list.items.find((item) => item.lemma === 'asylum')).toMatchObject({ cefr: 'C1', cefr_source: 'curated' })
  })
})
