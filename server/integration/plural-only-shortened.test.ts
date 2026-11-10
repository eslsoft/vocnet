import { createEntryResultSchema, createSenseResultSchema, publicEntrySchema } from '@shared/catalog'
import { factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { call, deliverPendingReviews, issueAgentKey, stubReviewers } from './helpers'

const post = async (token: string, path: string, json: unknown) => call(path, { method: 'POST', token, json })

async function nounEntry(token: string, lemma: string, gloss: string) {
  const { entry } = createEntryResultSchema.parse((await post(token, '/manage/v1/entries', { lemma })).body)
  const { sense } = createSenseResultSchema.parse(
    (await post(token, '/manage/v1/senses', { entry_id: entry.id, pos: 'noun', gloss })).body,
  )
  return { entry, sense }
}

describe('plural-only nouns and shortened words', () => {
  afterEach(() => vi.restoreAllMocks())

  it('publishes a plural-only noun without countability and a shortened word with its source [spec: facts/plural-only-shortened-api]', async () => {
    const token = await issueAgentKey()
    const jeans = await nounEntry(token, 'jeans', 'Trousers made of denim.')
    const mrs = await nounEntry(token, 'Mrs', 'A title used before the name of a married woman.')
    const submit = (json: unknown) => post(token, '/manage/v1/facts', json)

    const refused = await submit({
      kind: 'grammar',
      subject_id: jeans.sense.id,
      payload: { countability: 'countable', number: 'plural_only' },
    })
    expect([refused.status, apiErrorSchema.parse(refused.body).error.code]).toEqual([422, 'invalid_reference'])
    const grammar = await submit({ kind: 'grammar', subject_id: jeans.sense.id, payload: { number: 'plural_only' } })
    expect(grammar.status).toBe(201)
    const shortened = { type: 'abbreviation', of: 'mistress' }
    const formation = await submit({
      kind: 'morphology',
      subject_id: mrs.entry.id,
      payload: { parts: [{ form: 'Mrs', role: 'base' }], shortened },
    })
    expect(factWriteResultSchema.parse(formation.body).fact.payload).toEqual({
      parts: [{ form: 'Mrs', role: 'base' }],
      shortened,
    })
    stubReviewers()
    await deliverPendingReviews()

    const entryOf = async (lemma: string) => publicEntrySchema.parse((await call(`/v1/entries/${lemma}`)).body)
    expect((await entryOf('jeans')).meanings[0]?.senses[0]?.grammar).toMatchObject({ number: 'plural_only' })
    expect((await entryOf('jeans')).meanings[0]?.senses[0]?.grammar).not.toHaveProperty('countability')
    expect((await entryOf('Mrs')).morphology).toMatchObject({ parts: [{ form: 'Mrs', role: 'base' }], shortened })
  })
})
