import { env } from 'cloudflare:test'
import { claimStatement } from '@server/adapters/repos/work'
import { createDb } from '@server/db/client'
import type { PrincipalRef } from '@server/domain/principal'
import { createEntryResultSchema, createSenseResultSchema, managedEntrySchema } from '@shared/catalog'
import { factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { type WorkLeaseId, workClaimSchema, workCompletionSchema } from '@shared/work'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminToken, call, deliverPendingReviews, deliverReviews, issueAgentKey, stubReviewers } from './helpers'

const postEntry = (token: string, json: { lemma: string; seed?: boolean }) =>
  call('/manage/v1/entries', { method: 'POST', token, json })
const createEntry = async (token: string, lemma: string) =>
  createEntryResultSchema.parse((await postEntry(token, { lemma })).body)

const claim = (token: string, json?: unknown) => call('/manage/v1/work/claim', { method: 'POST', token, json })
const complete = (token: string, leaseId: string, json?: unknown) =>
  call(`/manage/v1/work/${leaseId}/complete`, { method: 'POST', token, json })
const codeOf = (body: unknown) => apiErrorSchema.parse(body).error.code
const lemmaOf = async (token: string) => {
  const result = await claim(token)
  return result.status === 204 ? null : workClaimSchema.parse(result.body).lease.lemma
}
const postSense = async (token: string, entryId: string, gloss: string) =>
  createSenseResultSchema.parse(
    (await call('/manage/v1/senses', { method: 'POST', token, json: { entry_id: entryId, pos: 'noun', gloss } })).body,
  )
const submitFact = async (token: string, json: unknown) =>
  factWriteResultSchema.parse((await call('/manage/v1/facts', { method: 'POST', token, json })).body).fact
/** Gives the entry a preposition sense, which needs no relations, and every other slot; returns the facts. */
const fill = async (token: string, entryId: string) => {
  const { sense } = createSenseResultSchema.parse(
    (
      await call('/manage/v1/senses', {
        method: 'POST',
        token,
        json: { entry_id: entryId, pos: 'preposition', gloss: 'Near to.' },
      })
    ).body,
  )
  const form = await submitFact(token, { kind: 'form', subject_id: entryId, payload: { form: 'bys', type: 'plural' } })
  const ipa = await submitFact(token, {
    kind: 'pronunciation',
    subject_id: entryId,
    payload: { ipa: 'baɪ', accent: 'us' },
  })
  const translation = await submitFact(token, {
    kind: 'translation',
    subject_id: sense.id,
    payload: { language: 'zh', text: '在旁边' },
  })
  const example = await submitFact(token, { kind: 'example', subject_id: sense.id, payload: { text: 'Sit by me.' } })
  return [form, ipa, translation, example]
}
/** Claims and completes the next entry with `during`'s result, which runs while the lease is held. */
const lemmaOfWork = async <T>(token: string, during: (lease: { lemma: string; entry_id: string }) => Promise<T>) => {
  const work = workClaimSchema.parse((await claim(token)).body)
  const result = await during(work.lease)
  expect((await complete(token, work.lease.id)).status).toBe(200)
  return { lemma: work.lease.lemma, entryId: work.lease.entry_id, result }
}
/** Claims and completes the next entry, running `during` while the lease is held. */
const pass = async (token: string, during?: (lease: { lemma: string; entry_id: string }) => Promise<unknown>) => {
  const work = workClaimSchema.parse((await claim(token)).body)
  await during?.(work.lease)
  expect((await complete(token, work.lease.id)).status).toBe(200)
  return work.lease.lemma
}
/** Lets every pending review land with passing reviewers, as the queue does within seconds. */
const settle = async () => {
  const reviewers = stubReviewers()
  await deliverPendingReviews()
  reviewers.mockRestore()
}
/** Runs the worklist score backfills in migration order, as a deploy over existing rows does. */
const runBackfills = async () => {
  const backfills = env.TEST_MIGRATIONS.filter(
    (migration) =>
      migration.name.endsWith('worklist_scores_backfill.sql') || migration.name.endsWith('worklist_topics_scores.sql'),
  )
  expect(backfills).toHaveLength(2)
  for (const query of backfills.flatMap((migration) => migration.queries)) await env.DB.prepare(query).run()
}
const expireLeases = () =>
  env.DB.prepare('update worklist set lease_expires_at = ? where lease_id is not null')
    .bind(new Date(Date.now() - 1000).toISOString())
    .run()

describe('worklist', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('claims an entry with its gaps and completes it [spec: work/claim-api]', async () => {
    const holder = await issueAgentKey('holder')
    const other = await issueAgentKey('other')
    const { entry } = await createEntry(holder, 'tide')
    expect((await call('/manage/v1/work/claim', { method: 'POST' })).status).toBe(401)
    expect((await claim(holder)).status).toBe(204)
    await settle()

    const claimed = await claim(holder, { lease_seconds: 600 })
    expect(claimed.status).toBe(200)
    const work = workClaimSchema.parse(claimed.body)
    expect(work.lease).toMatchObject({ entry_id: entry.id, lemma: 'tide', holder: expect.stringMatching(/^agent:/) })
    expect(Date.parse(work.lease.expires_at) - Date.now()).toBeGreaterThan(590_000)
    const view = managedEntrySchema.parse((await call('/manage/v1/entries/tide', { token: holder })).body)
    expect(work.entry).toEqual(view)
    expect(work.gaps).toEqual([{ type: 'senses' }, { type: 'forms' }, { type: 'pronunciation' }])
    expect(work.weak_facts).toEqual([])
    expect(work.entry).toMatchObject({ completeness: 0, quality: 1 })

    expect((await claim(other)).status).toBe(204)
    const stolen = await complete(other, work.lease.id)
    expect([stolen.status, codeOf(stolen.body)]).toEqual([409, 'conflict'])

    await postSense(holder, entry.id, 'The rise and fall of the sea.')
    const done = await complete(holder, work.lease.id, { note: 'Added a sense.' })
    expect(done.status).toBe(200)
    expect(workCompletionSchema.parse(done.body).entry_id).toBe(entry.id)
    const again = await complete(holder, work.lease.id)
    expect([again.status, codeOf(again.body)]).toEqual([404, 'not_found'])

    expect((await claim(holder)).status).toBe(204)
    await settle()
    const byAdmin = workClaimSchema.parse((await claim(await adminToken())).body)
    expect(byAdmin.lease).toMatchObject({ entry_id: entry.id, holder: 'admin:admin-1' })
  })

  it('rejects a lease_seconds outside 60..3600', async () => {
    const token = await issueAgentKey()
    const tooShort = await claim(token, { lease_seconds: 59 })
    expect([tooShort.status, codeOf(tooShort.body)]).toEqual([400, 'invalid_request'])
  })

  it('gives concurrent claims distinct entries [spec: work/claim-race]', async () => {
    const tokens = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((name) => issueAgentKey(name)))
    const lemmas = ['bay', 'cove', 'fjord']
    for (const lemma of lemmas) await createEntry(tokens[0], lemma)
    await settle()

    const results = await Promise.all(tokens.map((token) => claim(token)))
    const won = results.filter((result) => result.status === 200).map((result) => workClaimSchema.parse(result.body))
    expect(won.map((work) => work.lease.lemma).sort()).toEqual(lemmas)
    expect(results.filter((result) => result.status === 204)).toHaveLength(2)
  })

  it('lets another agent claim an expired lease, which its holder can no longer complete [spec: work/lease-expiry-api]', async () => {
    const first = await issueAgentKey('first')
    const second = await issueAgentKey('second')
    const { entry } = await createEntry(first, 'tide')
    await settle()
    const lapsed = workClaimSchema.parse((await claim(first)).body)
    await expireLeases()

    const late = await complete(first, lapsed.lease.id)
    expect([late.status, codeOf(late.body)]).toEqual([409, 'conflict'])
    const taken = workClaimSchema.parse((await claim(second)).body)
    expect(taken.lease).toMatchObject({ entry_id: entry.id })
    expect(taken.lease.id).not.toBe(lapsed.lease.id)
    expect((await complete(second, taken.lease.id)).status).toBe(200)
  })

  it('claims never-claimed seed entries before other never-claimed entries [spec: work/claim-seeds-first]', async () => {
    const token = await issueAgentKey()
    for (const lemma of ['bay', 'cove']) await createEntry(token, lemma)
    expect((await postEntry(token, { lemma: 'fjord', seed: true })).status).toBe(201)
    const marked = await postEntry(token, { lemma: 'cove', seed: true })
    expect(marked.status).toBe(200)
    expect(createEntryResultSchema.parse(marked.body)).toMatchObject({ created: false, entry: { lemma: 'cove' } })
    expect((await postEntry(token, { lemma: 'fjord', seed: false })).status).toBe(200)
    await settle()

    const order = []
    for (let step = 0; step < 4; step++) order.push(await lemmaOf(token))
    expect(order).toEqual(['cove', 'fjord', 'bay', null])
  })

  it('says in the entry view and the claim whether an entry is a seed entry [spec: work/entry-seed]', async () => {
    const token = await issueAgentKey()
    await postEntry(token, { lemma: 'cove', seed: true })
    await createEntry(token, 'bay')
    const seedOf = async (lemma: string) =>
      managedEntrySchema.parse((await call(`/manage/v1/entries/${lemma}`, { token })).body).seed
    expect([await seedOf('cove'), await seedOf('bay')]).toEqual([true, false])
    await settle()
    const claims = [workClaimSchema.parse((await claim(token)).body), workClaimSchema.parse((await claim(token)).body)]
    expect(claims.map((work) => [work.lease.lemma, work.entry.seed])).toEqual([
      ['cove', true],
      ['bay', false],
    ])
  })

  it('moves an entry whose lease lapsed behind the entries claimed less recently, however incomplete [spec: work/claim-rotation]', async () => {
    const token = await issueAgentKey()
    await createEntry(token, 'bay')
    for (const lemma of ['cove', 'fjord']) {
      const { entry } = await createEntry(token, lemma)
      await submitFact(token, { kind: 'form', subject_id: entry.id, payload: { form: `${lemma}s`, type: 'plural' } })
    }
    await settle()
    expect(await lemmaOf(token)).toBe('bay')
    await expireLeases()

    expect(await lemmaOf(token)).toBe('cove')
    expect(await lemmaOf(token)).toBe('fjord')
    await expireLeases()
    expect(await lemmaOf(token)).toBe('bay')
    // Bay, the least complete, lapses again; it waits behind cove and fjord.
    await expireLeases()
    expect(await lemmaOf(token)).toBe('cove')
    expect(await lemmaOf(token)).toBe('fjord')
    expect(await lemmaOf(token)).toBe('bay')
  })

  it('hands each expired lease to exactly one of the claims racing for it [spec: work/claim-expired-race]', async () => {
    const tokens = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((name) => issueAgentKey(name)))
    const lemmas = ['bay', 'cove', 'fjord']
    for (const lemma of lemmas) await createEntry(tokens[0], lemma)
    await settle()
    for (const token of tokens.slice(0, 3)) expect((await claim(token)).status).toBe(200)
    expect((await claim(tokens[3])).status).toBe(204)
    await expireLeases()

    const results = await Promise.all(tokens.map((token) => claim(token)))
    const won = results.filter((result) => result.status === 200).map((result) => workClaimSchema.parse(result.body))
    expect(won.map((work) => work.lease.lemma).sort()).toEqual(lemmas)
    expect(new Set(won.map((work) => work.lease.holder)).size).toBe(3)
    expect(results.filter((result) => result.status === 204)).toHaveLength(3)
  })

  it('serves an entry only while its entry fact is live [spec: work/claim-live]', async () => {
    const admin = await adminToken()
    const { fact } = await createEntry(admin, 'tide')
    const retracted = await call(`/manage/v1/facts/${fact.id}/retract`, { method: 'POST', token: admin })
    expect(retracted.status).toBe(200)
    expect(await lemmaOf(admin)).toBeNull()

    await createEntry(admin, 'tide')
    expect(await lemmaOf(admin)).toBeNull()
    await settle()
    expect(await lemmaOf(admin)).toBe('tide')
  })

  it('answers 204 once every entry is complete and good [spec: work/claim-empty]', async () => {
    const token = await issueAgentKey()
    const by = await createEntry(token, 'by')
    const of = await createEntry(token, 'of')
    await settle()
    const facts = await fill(token, by.entry.id)
    const scoresOf = async (lemma: string) =>
      managedEntrySchema.parse((await call(`/manage/v1/entries/${lemma}`, { token })).body)
    expect(await scoresOf('by')).toMatchObject({ completeness: 1, quality: 1 })
    expect(await lemmaOf(token)).toBe('of')
    await fill(token, of.entry.id)
    expect(await lemmaOf(token)).toBeNull()

    // A rejection reopens the gap; the entry is claimable once its other facts are reviewed too.
    stubReviewers(0.05, 'fail')
    await deliverReviews([facts.at(-1)?.id as string])
    vi.restoreAllMocks()
    expect(await scoresOf('by')).toMatchObject({ completeness: 1 - 1 / 5, quality: 1 })
    expect(await lemmaOf(token)).toBeNull()
    await settle()
    expect(await lemmaOf(token)).toBe('by')
    expect(await lemmaOf(token)).toBeNull()
  })

  it('stalls an entry whose pass made no lasting progress until another principal changes its work [spec: work/stall-api]', async () => {
    const token = await issueAgentKey()
    const other = await issueAgentKey('other')
    const bay = await createEntry(token, 'bay')
    const inlet = await postSense(other, bay.entry.id, 'A broad inlet of the sea.')
    expect((await postEntry(token, { lemma: 'cove', seed: true })).status).toBe(201)
    await settle()
    const cove = await lemmaOfWork(token, async (work) => {
      const nook = await postSense(token, work.entry_id, 'A small sheltered bay.')
      return nook
    })
    expect(cove.lemma).toBe('cove')
    await settle()

    // The second pass links cove to bay and ends with the link pending: neither end is claimable.
    const linked = await lemmaOfWork(token, () =>
      submitFact(token, {
        kind: 'relation',
        subject_id: cove.result.sense.id,
        payload: { type: 'hypernym', target_sense_id: inlet.sense.id },
      }),
    )
    expect(linked.lemma).toBe('cove')
    expect(await lemmaOf(token)).toBeNull()
    // Review rejects the link after the lease ended: the open work is back to the claim's.
    stubReviewers(0.05, 'fail')
    await deliverReviews([linked.result.id])
    vi.restoreAllMocks()
    expect(await pass(token)).toBe('bay')
    expect(await lemmaOf(token)).toBeNull()
    const stalled = await env.DB.prepare('select stalled from worklist where entry_id = ?').bind(cove.entryId).first()
    expect(stalled).toEqual({ stalled: 1 })

    await submitFact(other, {
      kind: 'example',
      subject_id: cove.result.sense.id,
      payload: { text: 'The boat rested in the cove.' },
    })
    await settle()
    expect(await lemmaOf(token)).toBe('cove')
  })

  it('names the weak facts in the claim, from uncertain reviews and open feedback [spec: work/weak-facts]', async () => {
    const token = await issueAgentKey()
    const by = await createEntry(token, 'by')
    const [form, , , example] = await fill(token, by.entry.id)
    stubReviewers()
    await deliverPendingReviews()
    expect(await lemmaOf(token)).toBeNull()
    vi.restoreAllMocks()
    stubReviewers(0.6, 'uncertain')
    const rereview = await call(`/manage/v1/facts/${example.id}/rereview`, {
      method: 'POST',
      token: await adminToken(),
    })
    expect(rereview.status).toBe(200)
    await deliverReviews([example.id])

    const first = workClaimSchema.parse((await claim(token)).body)
    expect(first.gaps).toEqual([])
    expect(first.weak_facts).toEqual([{ id: example.id, kind: 'example', reason: 'uncertain' }])
    expect(first.entry).toMatchObject({ completeness: 1, quality: 1 - 1 / 6 })
    expect((await complete(token, first.lease.id)).status).toBe(200)
    expect(await lemmaOf(token)).toBeNull()

    const report = await call('/v1/feedback', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.1' },
      json: { target_type: 'fact', target_id: form.id, message: 'That is no plural.' },
    })
    expect(report.status).toBe(201)
    const second = workClaimSchema.parse((await claim(token)).body)
    expect(second.weak_facts).toEqual([
      { id: form.id, kind: 'form', reason: 'feedback' },
      { id: example.id, kind: 'example', reason: 'uncertain' },
    ])
  })

  it('backfills the same scores the rescore stores [spec: work/scores-backfill]', async () => {
    const token = await issueAgentKey()
    const by = await createEntry(token, 'by')
    const [form] = await fill(token, by.entry.id)
    stubReviewers()
    await deliverPendingReviews()
    vi.restoreAllMocks()
    const cove = await createEntry(token, 'cove')
    const nook = await postSense(token, cove.entry.id, 'A small sheltered bay.')
    const quick = await postSense(token, cove.entry.id, 'Fast in movement.')
    await call('/manage/v1/senses', {
      method: 'POST',
      token,
      json: { entry_id: cove.entry.id, pos: 'adverb', gloss: 'In a sheltered way.' },
    })
    const tide = await createEntry(token, 'tide')
    const sea = await postSense(token, tide.entry.id, 'The rise and fall of the sea.')
    await submitFact(token, {
      kind: 'relation',
      subject_id: quick.sense.id,
      payload: { type: 'synonym', target_sense_id: sea.sense.id },
    })
    await submitFact(token, { kind: 'topic', subject_id: sea.sense.id, payload: { topic_id: 'water-bodies' } })
    stubReviewers(0.6, 'uncertain')
    await deliverPendingReviews()
    const report = await call('/v1/feedback', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.1' },
      json: { target_type: 'fact', target_id: form.id, message: 'Not a plural.' },
    })
    expect(report.status).toBe(201)
    await submitFact(token, { kind: 'example', subject_id: nook.sense.id, payload: { text: 'A boat in the cove.' } })

    const scores = () =>
      env.DB.prepare(
        'select entry_id, completeness, quality, awaiting_review, stalled from worklist order by entry_id',
      ).all()
    const stored = (await scores()).results
    await env.DB.prepare(
      'update worklist set completeness = 0.5, quality = 0.5, awaiting_review = 1 - awaiting_review',
    ).run()
    await runBackfills()
    expect((await scores()).results).toEqual(stored)
    expect(stored.map((row) => row.quality)).not.toEqual([1, 1, 1])
    expect(stored.find((row) => row.entry_id === cove.entry.id)?.awaiting_review).toBe(1)
    expect(stored.find((row) => row.entry_id === tide.entry.id)?.awaiting_review).toBe(0)
  })

  it('lifts the stall of an entry whose topics gap no claim recorded [spec: work/topics-rescore]', async () => {
    const token = await issueAgentKey()
    const by = await createEntry(token, 'by')
    await fill(token, by.entry.id)
    const cove = await createEntry(token, 'cove')
    await postSense(token, cove.entry.id, 'A small sheltered bay.')
    await settle()
    // Both stalled on open work recorded before topics gaps existed.
    await env.DB.prepare(
      `update worklist set stalled = 1, claimed_work = '{"gaps":[],"weak":[]}', claimed_at = ?, last_worked_at = ?`,
    )
      .bind(new Date().toISOString(), new Date().toISOString())
      .run()
    await runBackfills()
    const stalled = await env.DB.prepare('select entry_id, stalled from worklist').all<{
      entry_id: string
      stalled: number
    }>()
    const byEntry = Object.fromEntries(stalled.results.map((row) => [row.entry_id, row.stalled]))
    expect(byEntry).toEqual({ [by.entry.id]: 1, [cove.entry.id]: 0 })
  })

  it('reads the claim order from an index, without sorting the worklist [spec: work/claim-index]', async () => {
    const lease = {
      id: '00000000-0000-4000-8000-000000000001' as WorkLeaseId,
      holder: 'agent:a' as PrincipalRef,
      expiresAt: new Date().toISOString(),
    }
    const { sql, params } = claimStatement(createDb(env), lease, new Date().toISOString()).toSQL()
    const { results } = await env.DB.prepare(`explain query plan ${sql}`)
      .bind(...params)
      .all<{ detail: string }>()
    const plan = results.map((row) => row.detail)
    console.info(`claim query plan:\n${plan.join('\n')}`)
    expect(plan).toContain('SEARCH worklist USING INDEX worklist_claim_order_idx (claim_rank>?)')
    expect(plan.some((step) => step.includes('TEMP B-TREE'))).toBe(false)
  })
})
