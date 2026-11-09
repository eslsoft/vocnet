import { env } from 'cloudflare:test'
import { entrySummaryStatements } from '@server/adapters/repos/nodes'
import { encodeCursor } from '@server/adapters/repos/rows'
import { createDb } from '@server/db/client'
import {
  createEntryResultSchema,
  createSenseResultSchema,
  entryPageSchema,
  entrySummaryPageSchema,
  formLookupSchema,
  managedEntrySchema,
  nodeLocationSchema,
  publicEntrySchema,
  publicSenseWithEntrySchema,
} from '@shared/catalog'
import { factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { workClaimSchema } from '@shared/work'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminToken, call, deliverPendingReviews, deliverReviews, issueAgentKey, stubReviewers } from './helpers'

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
        json: { entry_id: entry.entry.id, pos: 'noun', gloss: 'Land beside a river.' },
      })
    ).body,
  )
  const shore = createSenseResultSchema.parse(
    (
      await call('/manage/v1/senses', {
        method: 'POST',
        token,
        json: { entry_id: shoreEntry.entry.id, pos: 'noun', gloss: 'Land along water.' },
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
    // A synonym is stored once, from the smaller sense id; both senses list it.
    const riverIsSubject = river.sense.id < shore.sense.id
    expect(entry.forms).toEqual([
      expect.objectContaining({ form: 'banks', type: 'plural', verdict: 'pass', confidence: 0.93 }),
    ])
    expect(entry.senses).toEqual([
      expect.objectContaining({
        id: river.sense.id,
        gloss: 'Land beside a river.',
        examples: [expect.objectContaining({ text: 'We sat on the bank.', confidence: 0.88 })],
        relations: [
          expect.objectContaining({
            type: 'synonym',
            direction: riverIsSubject ? 'outgoing' : 'incoming',
            sense: expect.objectContaining({ id: shore.sense.id, lemma: 'shore' }),
          }),
        ],
      }),
    ])
    const sense = publicSenseWithEntrySchema.parse((await call(`/v1/senses/${river.sense.id}`)).body)
    expect(sense.entry.lemma).toBe('bank')
    const incoming = publicEntrySchema.parse((await call('/v1/entries/shore')).body)
    expect(incoming.senses[0]?.relations).toEqual([
      expect.objectContaining({ direction: riverIsSubject ? 'incoming' : 'outgoing' }),
    ])
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

  it('lists entries in every status with their counts, page by page [spec: catalog/manage-entry-list]', async () => {
    const { token, river, relation } = await seedBank()
    for (const lemma of ['band', 'bar', 'cat'])
      await call('/manage/v1/entries', { method: 'POST', token, json: { lemma } })
    stubReviewers()
    await deliverReviews([river.fact.id])
    const example = factWriteResultSchema.parse(
      (
        await call('/manage/v1/facts', {
          method: 'POST',
          token,
          json: { kind: 'example', subject_id: river.sense.id, payload: { text: 'The bank flooded.' } },
        })
      ).body,
    )
    await call(`/manage/v1/facts/${example.fact.id}/retract`, { method: 'POST', token })
    // The seed mark puts bank ahead of the emptier entries.
    await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'bank', seed: true } })
    const { lease } = workClaimSchema.parse((await call('/manage/v1/work/claim', { method: 'POST', token })).body)
    expect(lease.lemma).toBe('bank')
    await call(`/manage/v1/work/${lease.id}/complete`, { method: 'POST', token })

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

    const [, bank] = entrySummaryPageSchema.parse((await call('/manage/v1/entries?prefix=ba', { token })).body).items
    expect(bank).toMatchObject({
      lemma: 'bank',
      entry_status: 'pending',
      sense_count: 1,
      // The synonym counts under whichever entry owns its subject sense.
      fact_counts: {
        pending: relation.fact.subject_id === river.sense.id ? 4 : 3,
        published: 1,
        rejected: 0,
        superseded: 0,
        retracted: 1,
      },
      last_worked_at: expect.any(String),
    })
    const all = entrySummaryPageSchema.parse((await call('/manage/v1/entries', { token: await adminToken() })).body)
    expect(all.items.map((item) => [item.lemma, item.entry_status, item.last_worked_at])).toEqual([
      ['band', 'pending', null],
      ['bank', 'pending', bank?.last_worked_at],
      ['bar', 'pending', null],
      ['cat', 'pending', null],
      ['shore', 'pending', null],
    ])
    expect((await call('/manage/v1/entries/bank', { token })).status).toBe(200)
    const broken = await call('/manage/v1/entries?cursor=broken', { token })
    expect([broken.status, apiErrorSchema.parse(broken.body).error.code]).toEqual([400, 'invalid_cursor'])
  })

  it('reads only the page when it lists entries [spec: catalog/manage-entry-list-index]', async () => {
    const cursor = encodeCursor({ lemma: 'ba' })
    const plans = await Promise.all(
      entrySummaryStatements(createDb(env), 'b', { limit: 50, cursor }).map(async (statement) => {
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
    const [, , , glossed] = plans
    expect(glossed[0]).toBe('SEARCH senses USING INDEX senses_creation_idx (entry_id=?)')
    expect(glossed).toContain('SEARCH facts USING INDEX facts_subject_idx (subject_id=? AND status=?)')
  })

  it('resolves an entry or sense id to its entry [spec: catalog/locate-node]', async () => {
    const { token } = await seedBank()
    const view = managedEntrySchema.parse((await call('/manage/v1/entries/bank', { token })).body)
    const owner = { id: view.entry.id, lemma: 'bank' }
    const ofEntry = nodeLocationSchema.parse((await call(`/manage/v1/nodes/${view.entry.id}`, { token })).body)
    const ofSense = nodeLocationSchema.parse((await call(`/manage/v1/nodes/${view.senses[0].id}`, { token })).body)
    expect(ofEntry).toEqual({ node_type: 'entry', entry: owner })
    expect(ofSense).toEqual({ node_type: 'sense', entry: owner })
    const missing = await call(`/manage/v1/nodes/${crypto.randomUUID()}`, { token })
    expect(missing.status).toBe(404)
  })
})
