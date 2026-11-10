import { env } from 'cloudflare:test'
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

describe('plural-only and shortened release', () => {
  it('lifts every stall and makes every worklist row stale [spec: work/plural-only-shortened-migration]', async () => {
    const token = await issueAgentKey()
    for (const lemma of ['jeans', 'Mrs']) await post(token, '/manage/v1/entries', { lemma })
    await env.DB.prepare(
      `update worklist set scored_revision = revision, stalled = 1, claimed_work = '{"gaps":[]}'`,
    ).run()

    const migration = env.TEST_MIGRATIONS.find((candidate) =>
      candidate.name.endsWith('_plural_only_titles_shortened.sql'),
    )
    if (!migration) throw new Error('The plural_only_titles_shortened migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()

    const rows = await env.DB.prepare(
      'select count(*) as n, sum(stalled) as stalled, sum(claimed_work is not null) as claimed, sum(revision = scored_revision) as fresh from worklist',
    ).first()
    expect(rows).toMatchObject({ stalled: 0, claimed: 0, fresh: 0 })
    expect(rows?.n).toBeGreaterThanOrEqual(2)
  })
})
