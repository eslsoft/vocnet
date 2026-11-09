import {
  createEntryResultSchema,
  createSenseResultSchema,
  entryPageSchema,
  formLookupSchema,
  managedEntrySchema,
  publicEntrySchema,
  publicSenseWithEntrySchema,
} from '@shared/catalog'
import { factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { call, deliverPendingReviews, issueAgentKey, stubReviewers } from './helpers'

async function seedBank() {
  const token = await issueAgentKey()
  const entry = createEntryResultSchema.parse(
    (await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'bank' } })).body,
  )
  const shoreEntry = createEntryResultSchema.parse(
    (await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'shore' } })).body,
  )
  const river = createSenseResultSchema.parse(
    (
      await call('/manage/v1/senses', {
        method: 'POST',
        token,
        json: { entry_id: entry.entry.id, pos: 'noun', gloss: 'land beside a river' },
      })
    ).body,
  )
  const shore = createSenseResultSchema.parse(
    (
      await call('/manage/v1/senses', {
        method: 'POST',
        token,
        json: { entry_id: shoreEntry.entry.id, pos: 'noun', gloss: 'land along water' },
      })
    ).body,
  )
  const submit = (json: unknown) => call('/manage/v1/facts', { method: 'POST', token, json })
  await submit({ kind: 'form', subject_id: entry.entry.id, payload: { form: 'banks', type: 'plural' } })
  await submit({ kind: 'example', subject_id: river.sense.id, payload: { text: 'We sat on the bank.' } })
  const relation = factWriteResultSchema.parse(
    (
      await submit({
        kind: 'relation',
        subject_id: river.sense.id,
        payload: { type: 'synonym', target_sense_id: shore.sense.id },
      })
    ).body,
  )
  return { token, entry, river, shore, relation }
}

describe('public catalog', () => {
  afterEach(() => vi.restoreAllMocks())

  it('serves a reviewed entry with forms, senses, examples, and relations [spec: catalog/entry-read]', async () => {
    const { river, shore } = await seedBank()
    stubReviewers()
    await deliverPendingReviews()

    const { status, body } = await call('/v1/entries/bank')
    expect(status).toBe(200)
    const entry = publicEntrySchema.parse(body)
    expect(entry.forms).toEqual([
      expect.objectContaining({ form: 'banks', type: 'plural', verdict: 'pass', confidence: 0.93 }),
    ])
    expect(entry.senses).toEqual([
      expect.objectContaining({
        id: river.sense.id,
        gloss: 'land beside a river',
        examples: [expect.objectContaining({ text: 'We sat on the bank.', confidence: 0.88 })],
        relations: [
          expect.objectContaining({
            type: 'synonym',
            direction: 'outgoing',
            sense: expect.objectContaining({ id: shore.sense.id, lemma: 'shore' }),
          }),
        ],
      }),
    ])
    const sense = publicSenseWithEntrySchema.parse((await call(`/v1/senses/${river.sense.id}`)).body)
    expect(sense.entry.lemma).toBe('bank')
    const incoming = publicEntrySchema.parse((await call('/v1/entries/shore')).body)
    expect(incoming.senses[0]?.relations).toEqual([expect.objectContaining({ direction: 'incoming' })])
  })

  it('404s unknown and unpublished lemmas, forms, and senses with no fallback [spec: catalog/entry-not-found]', async () => {
    const { river } = await seedBank()
    for (const path of ['/v1/entries/bank', '/v1/entries/banks', '/v1/forms/banks', `/v1/senses/${river.sense.id}`]) {
      const { status, body } = await call(path)
      expect(status).toBe(404)
      expect(apiErrorSchema.parse(body).error.code).toBe('not_found')
    }
  })

  it('looks up the entry an inflected form belongs to [spec: catalog/form-lookup-api]', async () => {
    await seedBank()
    stubReviewers()
    await deliverPendingReviews()
    const lookup = formLookupSchema.parse((await call('/v1/forms/banks')).body)
    expect(lookup.items).toEqual([expect.objectContaining({ entry: expect.objectContaining({ lemma: 'bank' }) })])
    expect((await call('/v1/forms/bank')).status).toBe(404)
  })

  it('pages through published entries by prefix and rejects a broken cursor [spec: catalog/search]', async () => {
    const token = await issueAgentKey()
    for (const lemma of ['band', 'bank', 'bar', 'cat'])
      await call('/manage/v1/entries', { method: 'POST', token, json: { lemma } })
    stubReviewers()
    await deliverPendingReviews()

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

  it('shows management every fact in every status [spec: catalog/manage-entry]', async () => {
    const { token } = await seedBank()
    const view = managedEntrySchema.parse((await call('/manage/v1/entries/bank', { token })).body)
    expect(view.facts.map((fact) => fact.status)).toEqual(view.facts.map(() => 'pending'))
    expect(view.facts.map((fact) => fact.kind).sort()).toEqual(['entry', 'example', 'form', 'relation', 'sense'])
  })
})
