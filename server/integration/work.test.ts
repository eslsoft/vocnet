import { env } from 'cloudflare:test'
import { leaseStatement, nextTypeStatement } from '@server/adapters/repos/work'
import { createDb } from '@server/db/client'
import type { PrincipalRef } from '@server/domain/principal'
import {
  coreImportResultSchema,
  createEntryResultSchema,
  createSenseResultSchema,
  managedEntrySchema,
} from '@shared/catalog'
import { factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import {
  curationPageSchema,
  type WorkLeaseId,
  type WorkType,
  workClaimSchema,
  workCompletionSchema,
} from '@shared/work'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adminToken,
  call,
  deliverPendingReviews,
  deliverReviews,
  importLearnerData,
  issueAgentKey,
  stubReviewers,
} from './helpers'

const postEntry = (token: string, json: { lemma: string; seed?: boolean }) =>
  call('/manage/v1/entries', { method: 'POST', token, json })
const createEntry = async (token: string, lemma: string) =>
  createEntryResultSchema.parse((await postEntry(token, { lemma })).body)

const claim = (token: string, json?: unknown) => call('/manage/v1/work/claim', { method: 'POST', token, json })
const complete = (token: string, leaseId: string, json: unknown = { items: [] }) =>
  call(`/manage/v1/work/${leaseId}/complete`, { method: 'POST', token, json })
const codeOf = (body: unknown) => apiErrorSchema.parse(body).error.code
/** The claim of the next items of these types; null when none is free. */
const claimOf = async (token: string, types?: WorkType[], limit = 10) => {
  const result = await claim(token, { ...(types ? { types } : {}), limit })
  return result.status === 204 ? null : workClaimSchema.parse(result.body)
}
const lemmasOf = async (token: string, types: WorkType[], limit = 10) =>
  (await claimOf(token, types, limit))?.items.map((item) => item.lemma) ?? null
const postSense = async (token: string, entryId: string, gloss: string) =>
  createSenseResultSchema.parse(
    (await call('/manage/v1/senses', { method: 'POST', token, json: { entry_id: entryId, pos: 'noun', gloss } })).body,
  )
const submitFact = async (token: string, json: unknown) =>
  factWriteResultSchema.parse((await call('/manage/v1/facts', { method: 'POST', token, json })).body).fact
/** Lets every pending review land with passing reviewers, as the queue does within seconds. */
const settle = async () => {
  const reviewers = stubReviewers()
  await deliverPendingReviews()
  reviewers.mockRestore()
}
const expireLeases = () =>
  Promise.all([
    env.DB.prepare('update work_items set lease_expires_at = ? where lease_id is not null')
      .bind(new Date(Date.now() - 1000).toISOString())
      .run(),
    env.DB.prepare('update work_leases set expires_at = ?')
      .bind(new Date(Date.now() - 1000).toISOString())
      .run(),
  ])
/** Claims the item of this type and completes the pass over it, running `during` while the lease is held. */
const pass = async (token: string, type: WorkType, during?: () => Promise<unknown>) => {
  const work = await claimOf(token, [type], 1)
  if (!work) throw new Error(`No ${type} item is free.`)
  await during?.()
  const items = work.items.map((item) => ({ id: item.id, note: 'Tried.' }))
  return workCompletionSchema.parse((await complete(token, work.lease.id, { items })).body).items
}

describe('work items', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('claims items of one type with their context and completes them [spec: work/claim-api]', async () => {
    const holder = await issueAgentKey('holder')
    const other = await issueAgentKey('other')
    const { entry } = await createEntry(holder, 'tide')
    expect((await call('/manage/v1/work/claim', { method: 'POST' })).status).toBe(401)
    // The entry fact is pending, so every item waits for its review.
    expect((await claim(holder)).status).toBe(204)
    await settle()

    const claimed = await claim(holder, { lease_seconds: 600 })
    expect(claimed.status).toBe(200)
    const work = workClaimSchema.parse(claimed.body)
    expect(work.lease).toMatchObject({ type: 'senses', holder: expect.stringMatching(/^agent:/) })
    expect(Date.parse(work.lease.expires_at) - Date.now()).toBeGreaterThan(590_000)
    expect(work.items).toHaveLength(1)
    const [item] = work.items
    expect(item).toMatchObject({
      type: 'senses',
      entry_id: entry.id,
      lemma: 'tide',
      subject_id: entry.id,
      stage: 1,
      attempts: 0,
      gap: { type: 'senses' },
      context: { entry: { id: entry.id, lemma: 'tide', cefr: [], zipf: null, senses: [] }, sense: null, related: [] },
    })
    const view = managedEntrySchema.parse((await call('/manage/v1/entries/tide', { token: holder })).body)
    expect(item?.context.view).toEqual(view)
    expect(item?.context.facts.map((fact) => fact.kind)).toEqual(['entry'])

    // The other agent gets the next type, then nothing; it cannot complete the holder's lease.
    const next = workClaimSchema.parse((await claim(other, { limit: 50 })).body)
    expect(next.items.map((other) => [other.lemma, other.stage])).toEqual([['tide', 3]])
    const stolen = await complete(other, work.lease.id)
    expect([stolen.status, codeOf(stolen.body)]).toEqual([409, 'conflict'])
    const foreign = await complete(holder, work.lease.id, { items: [{ id: next.items[0]?.id }] })
    expect([foreign.status, codeOf(foreign.body)]).toEqual([422, 'invalid_reference'])

    await postSense(holder, entry.id, 'The rise and fall of the sea.')
    const done = await complete(holder, work.lease.id, { items: [{ id: item?.id, note: 'Added a sense.' }] })
    expect(done.status).toBe(200)
    expect(workCompletionSchema.parse(done.body)).toEqual({
      lease_id: work.lease.id,
      items: [{ id: item?.id, state: 'awaiting_review', attempts: 0 }],
    })
    const again = await complete(holder, work.lease.id)
    expect([again.status, codeOf(again.body)]).toEqual([404, 'not_found'])
    // Once the sense publishes, the senses item is closed and the sense list is the identity work.
    await settle()
    expect(await claimOf(holder, ['senses'])).toBeNull()
    expect((await claimOf(holder, ['sense_list']))?.items[0]?.gap.type).toBe('sense_list')
  })

  it('rejects a claim body outside its bounds', async () => {
    const token = await issueAgentKey()
    for (const json of [{ lease_seconds: 59 }, { limit: 0 }, { limit: 51 }, { types: ['relations'] }, { types: [] }]) {
      const result = await claim(token, json)
      expect([result.status, codeOf(result.body)]).toEqual([400, 'invalid_request'])
    }
  })

  it('gives concurrent claims distinct items [spec: work/claim-race]', async () => {
    const tokens = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((name) => issueAgentKey(name)))
    const lemmas = ['bay', 'cove', 'fjord']
    for (const lemma of lemmas) await createEntry(tokens[0], lemma)
    await settle()
    const results = await Promise.all(tokens.map((token) => claim(token, { types: ['syllables'], limit: 1 })))
    const won = results.filter((result) => result.status === 200).map((result) => workClaimSchema.parse(result.body))
    expect(won.flatMap((work) => work.items.map((item) => item.lemma)).sort()).toEqual(lemmas)
    expect(results.filter((result) => result.status === 204)).toHaveLength(2)
  })

  it('hands each expired lease to exactly one of the claims racing for it [spec: work/claim-expired-race]', async () => {
    const tokens = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((name) => issueAgentKey(name)))
    for (const lemma of ['bay', 'cove', 'fjord']) await createEntry(tokens[0], lemma)
    await settle()
    for (const token of tokens.slice(0, 3)) expect(await lemmasOf(token, ['syllables'], 1)).toHaveLength(1)
    expect(await claimOf(tokens[3] as string, ['syllables'], 1)).toBeNull()
    await expireLeases()
    const results = await Promise.all(tokens.map((token) => claim(token, { types: ['syllables'], limit: 1 })))
    const won = results.filter((result) => result.status === 200).map((result) => workClaimSchema.parse(result.body))
    expect(won.flatMap((work) => work.items.map((item) => item.lemma)).sort()).toEqual(['bay', 'cove', 'fjord'])
    expect(new Set(won.map((work) => work.lease.holder)).size).toBe(3)
  })

  it('lets another agent claim an expired lease, which its holder can no longer complete [spec: work/lease-expiry-api]', async () => {
    const first = await issueAgentKey('first')
    const second = await issueAgentKey('second')
    await createEntry(first, 'tide')
    await settle()
    const lapsed = await claimOf(first, ['syllables'])
    await expireLeases()
    const late = await complete(first, lapsed?.lease.id as string)
    expect([late.status, codeOf(late.body)]).toEqual([409, 'conflict'])
    const taken = await claimOf(second, ['syllables'])
    expect(taken?.items.map((item) => item.id)).toEqual(lapsed?.items.map((item) => item.id))
    expect((await complete(second, taken?.lease.id as string)).status).toBe(200)
  })

  it('orders items by stage, then A1 to C2, then frequency without a level, then the rest, re-ranked by every import [spec: work/claim-priority]', async () => {
    const token = await issueAgentKey()
    for (const lemma of ['reef', 'wave', 'tide', 'cove', 'Bank', 'sea']) await createEntry(token, lemma)
    const data = {
      zipf: { bank: 5, cove: 3, tide: 4, wave: 4.5, shore: 6 },
      levels: { Bank: 'A1', cove: 'A1', sea: 'A1', tide: 'B2', shore: 'B1' } as const,
    }
    // The import re-ranks the items that exist; shore's items read the row its creation wrote.
    await importLearnerData(data)
    await createEntry(token, 'shore')
    await settle()
    // Bank has the frequency of its word form, "bank"; sea has a level but no frequency.
    expect(await lemmasOf(token, ['syllables'])).toEqual(['Bank', 'cove', 'sea', 'shore', 'tide', 'wave', 'reef'])
    // Identity outranks every later stage, whatever the band: senses before any syllables.
    expect((await claimOf(token, undefined, 1))?.lease.type).toBe('senses')
    // A reimport re-ranks: reef becomes the one A1 entry and comes first once the leases lapse.
    await importLearnerData({ zipf: data.zipf, levels: { reef: 'A1' } })
    await expireLeases()
    expect((await lemmasOf(token, ['syllables'], 1))?.[0]).toBe('reef')
  })

  it('counts an attempt for each pass that leaves a gap as claimed and hands it to the curators after three [spec: work/item-attempts-api]', async () => {
    const producer = await issueAgentKey('producer')
    const { entry } = await createEntry(producer, 'dawn')
    await settle()
    expect(await pass(producer, 'syllables')).toEqual([{ id: expect.any(String), state: 'open', attempts: 1 }])
    expect((await pass(producer, 'syllables'))[0]).toMatchObject({ state: 'open', attempts: 2 })
    expect((await pass(producer, 'syllables'))[0]).toMatchObject({ state: 'curation', attempts: 3 })
    expect(await claimOf(producer, ['syllables'])).toBeNull()

    const denied = await call('/manage/v1/work/curation', { token: producer })
    expect([denied.status, codeOf(denied.body)]).toEqual([403, 'forbidden'])
    const admin = await adminToken()
    const issued = await call('/manage/v1/agents', {
      method: 'POST',
      token: admin,
      json: { name: 'Curator', curator: true },
    })
    const curator = (issued.body as { key: string }).key
    const queue = curationPageSchema.parse(
      (await call('/manage/v1/work/curation?type=syllables', { token: curator })).body,
    )
    expect(queue).toMatchObject({
      items: [{ type: 'syllables', lemma: 'dawn', attempts: 3, last_note: 'Tried.', gap: { type: 'syllables' } }],
      next_cursor: null,
    })
    expect(
      curationPageSchema.parse((await call('/manage/v1/work/curation?type=senses', { token: admin })).body).items,
    ).toEqual([])
    // A curated fact fills the slot, which closes the item.
    await submitFact(curator, {
      kind: 'syllables',
      subject_id: entry.id,
      payload: { syllables: ['dawn'] },
      curation: { reason: 'One syllable.' },
    })
    expect(curationPageSchema.parse((await call('/manage/v1/work/curation', { token: curator })).body).items).toEqual(
      [],
    )
  })

  it('judges a worked item once its facts are reviewed, so a rejection after the lease counts the attempt [spec: work/item-review-api]', async () => {
    const token = await issueAgentKey()
    const { entry } = await createEntry(token, 'dawn')
    await settle()
    const states = await pass(token, 'syllables', () =>
      submitFact(token, { kind: 'syllables', subject_id: entry.id, payload: { syllables: ['da', 'wn'] } }),
    )
    expect(states).toEqual([{ id: expect.any(String), state: 'awaiting_review', attempts: 0 }])
    expect(await claimOf(token, ['syllables'])).toBeNull()
    stubReviewers(0.05, 'fail')
    await deliverPendingReviews()
    vi.restoreAllMocks()
    const back = await claimOf(token, ['syllables'])
    expect(back?.items[0]).toMatchObject({ attempts: 1, gap: { type: 'syllables' } })
    expect(back?.items[0]?.context.facts.find((fact) => fact.kind === 'syllables')).toMatchObject({
      status: 'rejected',
      review: { verdict: 'fail' },
    })
  })

  it('drops the items of an entry whose entry fact leaves live, and builds them again when it returns [spec: work/claim-live]', async () => {
    const admin = await adminToken()
    const { fact } = await createEntry(admin, 'tide')
    await settle()
    expect(await lemmasOf(admin, ['syllables'])).toEqual(['tide'])
    await expireLeases()
    expect((await call(`/manage/v1/facts/${fact.id}/retract`, { method: 'POST', token: admin })).status).toBe(200)
    expect(await claimOf(admin)).toBeNull()
    await createEntry(admin, 'tide')
    expect(await claimOf(admin)).toBeNull()
    await settle()
    expect(await lemmasOf(admin, ['syllables'])).toEqual(['tide'])
  })

  it('answers 204 once every gap is filled and no fact is weak, until a rejection reopens one [spec: work/claim-empty]', async () => {
    const token = await issueAgentKey()
    const { entry } = await createEntry(token, 'by')
    const { sense } = createSenseResultSchema.parse(
      (
        await call('/manage/v1/senses', {
          method: 'POST',
          token,
          json: { entry_id: entry.id, pos: 'preposition', gloss: 'Near to.' },
        })
      ).body,
    )
    const translation = await submitFact(token, {
      kind: 'translation',
      subject_id: sense.id,
      payload: { language: 'zh', text: '在旁边' },
    })
    for (const json of [
      { kind: 'morphology', subject_id: entry.id, payload: { parts: [{ form: 'by', role: 'base' }] } },
      { kind: 'pronunciation', subject_id: entry.id, payload: { ipa: 'baɪ', accent: 'us' } },
      { kind: 'pronunciation', subject_id: entry.id, payload: { ipa: 'baɪ', accent: 'uk' } },
      { kind: 'example', subject_id: sense.id, payload: { text: 'Sit by me.', translations: { zh: '坐在我旁边。' } } },
      { kind: 'collocation', subject_id: sense.id, payload: { text: 'by the river', pattern: 'phrase' } },
      { kind: 'sense_list', subject_id: entry.id, payload: { common: [sense.id], extra: [] } },
      { kind: 'syllables', subject_id: entry.id, payload: { syllables: ['by'] } },
    ]) {
      await submitFact(token, json)
    }
    await settle()
    expect(managedEntrySchema.parse((await call('/manage/v1/entries/by', { token })).body)).toMatchObject({
      completeness: 1,
      quality: 1,
    })
    expect((await claim(token)).status).toBe(204)
    // A rejection in place reopens the translation slot.
    expect(
      (await call(`/manage/v1/facts/${translation.id}/rereview`, { method: 'POST', token: await adminToken() })).status,
    ).toBe(200)
    stubReviewers(0.05, 'fail')
    await deliverReviews([translation.id])
    vi.restoreAllMocks()
    expect(await lemmasOf(token, ['translations'])).toEqual(['by'])
  })

  it('counts each relation slot once, and only while the sense at the other end can show [spec: work/relations-visible-ends-api]', async () => {
    const token = await issueAgentKey()
    const cove = await createEntry(token, 'cove')
    const nook = await postSense(token, cove.entry.id, 'A small sheltered bay.')
    const ends = await Promise.all(
      ['bay', 'inlet'].map(async (lemma) => {
        const { entry, fact } = await createEntry(token, lemma)
        const { sense, fact: gloss } = await postSense(token, entry.id, `A ${lemma} of the sea.`)
        await submitFact(token, {
          kind: 'relation',
          subject_id: nook.sense.id,
          payload: { type: 'hypernym', target_sense_id: sense.id },
        })
        return { entryFact: fact, gloss }
      }),
    )
    await submitFact(token, {
      kind: 'sense_list',
      subject_id: cove.entry.id,
      payload: { common: [nook.sense.id], extra: [] },
    })
    await settle()
    const stored = () =>
      env.DB.prepare('select completeness, revision = scored_revision as fresh from worklist where entry_id = ?')
        .bind(cove.entry.id)
        .first<{ completeness: number; fresh: number }>()
    // Fourteen slots: the sense inventory, pronunciation, word formation, syllables, and the noun
    // sense's category, parts (asked once it has a category), synonym, example, translation,
    // translated example, topic, grammar, and collocation. Two categories fill the one slot.
    expect(await stored()).toEqual({ completeness: 1 - 12 / 14, fresh: 1 })
    const [bay, inlet] = ends
    expect(
      (await call(`/manage/v1/facts/${inlet?.entryFact.id}/rereview`, { method: 'POST', token: await adminToken() }))
        .status,
    ).toBe(200)
    stubReviewers(0.05, 'fail')
    await deliverReviews([inlet?.entryFact.id as string])
    vi.restoreAllMocks()
    expect(await stored()).toEqual({ completeness: 1 - 12 / 14, fresh: 1 })
    // With no category left, the category slot opens and the parts slot goes.
    expect((await call(`/manage/v1/facts/${bay?.gloss.id}/retract`, { method: 'POST', token })).status).toBe(200)
    expect(await stored()).toEqual({ completeness: 1 - 12 / 13, fresh: 1 })
    expect(await lemmasOf(token, ['category'])).toEqual(['cove'])
  })

  it('lists a weak fact as an item of its own until a pass replaces it, and open feedback as another [spec: work/weak-facts-api]', async () => {
    const token = await issueAgentKey()
    const { entry } = await createEntry(token, 'by')
    const form = await submitFact(token, {
      kind: 'form',
      subject_id: entry.id,
      payload: { form: 'bye', type: 'variant' },
    })
    stubReviewers(0.6, 'uncertain')
    await deliverPendingReviews()
    vi.restoreAllMocks()
    const weak = await claimOf(token, ['weak_fact'], 50)
    expect(weak?.items.map((item) => item.gap)).toContainEqual({
      type: 'weak_fact',
      fact_id: form.id,
      kind: 'form',
      reason: 'uncertain',
    })
    expect(weak?.items[0]?.stage).toBe(5)
  })

  it('creates seed entries for the CEFR headwords without one, for admins only, each with its identity item first [spec: catalog/import-core-api]', async () => {
    await importLearnerData({
      zipf: { bank: 5, the: 7 },
      levels: { bank: 'A1', 'according to': 'B1', x: 'A1', the: 'A1' },
    })
    const agent = await issueAgentKey()
    await createEntry(agent, 'the')
    const admin = await adminToken()
    const importCore = (token: string, json: unknown) =>
      call('/manage/v1/entries/core', { method: 'POST', token, json })
    const denied = await importCore(agent, {})
    expect([denied.status, codeOf(denied.body)]).toEqual([403, 'forbidden'])
    const results = []
    for (let step = 0; step < 3; step++) {
      const result = await importCore(admin, { limit: 1 })
      expect(result.status).toBe(200)
      results.push(coreImportResultSchema.parse(result.body))
    }
    expect(results).toEqual([
      { created: ['bank'], skipped: ['x'], remaining: 1 },
      { created: ['according to'], skipped: ['x'], remaining: 0 },
      { created: [], skipped: ['x'], remaining: 0 },
    ])
    const view = async (lemma: string) =>
      managedEntrySchema.parse((await call(`/manage/v1/entries/${encodeURIComponent(lemma)}`, { token: agent })).body)
    expect([(await view('bank')).seed, (await view('according to')).seed, (await view('the')).seed]).toEqual([
      true,
      true,
      false,
    ])
    expect((await call('/manage/v1/entries/x', { token: agent })).status).toBe(404)
    // The agent's "the" is not a seed entry but is A1 and more frequent, so it comes first.
    await settle()
    expect(await lemmasOf(agent, ['senses'])).toEqual(['the', 'bank', 'according to'])
  })

  it('says in the entry view and in a whole-entry context whether an entry is a seed entry [spec: work/entry-seed]', async () => {
    const token = await issueAgentKey()
    await postEntry(token, { lemma: 'cove', seed: true })
    await createEntry(token, 'bay')
    const seedOf = async (lemma: string) =>
      managedEntrySchema.parse((await call(`/manage/v1/entries/${lemma}`, { token })).body).seed
    expect([await seedOf('cove'), await seedOf('bay')]).toEqual([true, false])
    await settle()
    const work = await claimOf(token, ['senses'])
    const seeds = work?.items.map((item) => [item.lemma, item.context.view?.seed])
    expect(seeds?.sort()).toEqual([
      ['bay', false],
      ['cove', true],
    ])
  })

  it('backfills the learner priority that creation and the import store [spec: work/priority-backfill]', async () => {
    await importLearnerData({ zipf: { bank: 5, café: 2 }, levels: { Bank: 'B1', bank: 'A2', café: 'A1' } })
    const token = await issueAgentKey()
    for (const lemma of ['Bank', 'bank', 'café', 'according to', 'reef']) await createEntry(token, lemma)
    const priority = async () =>
      (
        await env.DB.prepare(
          'select lemma, frequency_key, level_rank, zipf from worklist join entries on entries.id = worklist.entry_id order by lemma',
        ).all()
      ).results
    const stored = await priority()
    expect(stored).toEqual([
      { lemma: 'Bank', frequency_key: 'bank', level_rank: 3, zipf: 5 },
      { lemma: 'according to', frequency_key: 'according to', level_rank: null, zipf: null },
      { lemma: 'bank', frequency_key: 'bank', level_rank: 2, zipf: 5 },
      { lemma: 'café', frequency_key: 'café', level_rank: 1, zipf: 2 },
      { lemma: 'reef', frequency_key: 'reef', level_rank: null, zipf: null },
    ])
    await env.DB.prepare('update worklist set frequency_key = null, level_rank = 9, zipf = 0').run()
    const [backfill] = env.TEST_MIGRATIONS.filter((migration) =>
      migration.name.endsWith('_worklist_learner_priority_backfill.sql'),
    )
    for (const query of backfill?.queries ?? []) await env.DB.prepare(query).run()
    expect(await priority()).toEqual(stored)
  })

  it('reads the claim order from the queue indexes, without sorting the items [spec: work/claim-index]', async () => {
    const db = createDb(env)
    const now = new Date().toISOString()
    const lease = {
      id: '00000000-0000-4000-8000-000000000001' as WorkLeaseId,
      holder: 'agent:a' as PrincipalRef,
      type: 'category' as const,
      expiresAt: now,
    }
    const planOf = async ({ sql, params }: { sql: string; params: unknown[] }) => {
      const { results } = await env.DB.prepare(`explain query plan ${sql}`)
        .bind(...params)
        .all<{ detail: string }>()
      return results.map((row) => row.detail)
    }
    const next = await planOf(nextTypeStatement(db, undefined, now).toSQL())
    console.info(`next type query plan:\n${next.join('\n')}`)
    expect(next.some((step) => step.includes('USING INDEX work_items_queue_idx'))).toBe(true)
    expect(next.some((step) => step.includes('TEMP B-TREE'))).toBe(false)
    const leased = await planOf(leaseStatement(db, lease, 10, now).toSQL())
    console.info(`lease query plan:\n${leased.join('\n')}`)
    expect(leased.some((step) => step.includes('USING INDEX work_items_type_queue_idx (type=?)'))).toBe(true)
    expect(leased.some((step) => step.includes('TEMP B-TREE'))).toBe(false)
  })

  it('turns relations closures into synonyms closures, marks the published relations it re-judges, and leaves every row stale [spec: work/items-migration]', async () => {
    const token = await issueAgentKey()
    const { entry } = await createEntry(token, 'dog')
    const dog = await postSense(token, entry.id, 'An animal kept as a pet.')
    const animal = await postSense(token, (await createEntry(token, 'animal')).entry.id, 'A living creature.')
    const tail = await postSense(token, (await createEntry(token, 'tail')).entry.id, 'The part at the back.')
    const hypernym = await submitFact(token, {
      kind: 'relation',
      subject_id: dog.sense.id,
      payload: { type: 'hypernym', target_sense_id: animal.sense.id },
    })
    const partOf = await submitFact(token, {
      kind: 'relation',
      subject_id: tail.sense.id,
      payload: { type: 'part_of', target_sense_id: dog.sense.id },
    })
    const closure = await submitFact(token, {
      kind: 'gap_closure',
      subject_id: animal.sense.id,
      payload: { gap: 'synonyms', reason: 'Nothing else fits.' },
    })
    await settle()
    // The closure as the earlier release stored it, and one the curator settled.
    await env.DB.prepare(
      `update facts set payload = json_set(payload, '$.gap', 'relations'), content_key = 'relations|nothing else fits.' where id = ?`,
    )
      .bind(closure.id)
      .run()
    await env.DB.prepare(`update facts set review = json_set(review, '$.reviewer', 'curator') where id = ?`)
      .bind(partOf.id)
      .run()
    await env.DB.prepare('update worklist set scored_revision = revision').run()
    const migration = env.TEST_MIGRATIONS.find((candidate) =>
      candidate.name.endsWith('_work_items_relation_layers.sql'),
    )
    if (!migration) throw new Error('The work_items_relation_layers migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()
    const row = (id: string) =>
      env.DB.prepare(
        'select content_key, json_extract(payload, "$.gap") as gap, revalidate_since is not null as marked from facts where id = ?',
      )
        .bind(id)
        .first()
    expect(await row(closure.id)).toEqual({ content_key: 'synonyms|nothing else fits.', gap: 'synonyms', marked: 1 })
    expect(await row(hypernym.id)).toMatchObject({ marked: 1 })
    expect(await row(partOf.id)).toMatchObject({ marked: 0 })
    const fresh = await env.DB.prepare(
      'select count(*) as n, sum(revision = scored_revision) as fresh from worklist',
    ).first()
    expect(fresh).toEqual({ n: 3, fresh: 0 })
  })

  it('moves everyday hypernyms to a technical taxon into biology and marks the other hypernyms and parts [spec: work/layer-review-migration]', async () => {
    const token = await issueAgentKey()
    const sense = async (lemma: string, gloss: string) =>
      (await postSense(token, (await createEntry(token, lemma)).entry.id, gloss)).sense.id
    const [dog, canine, animal, head] = [
      await sense('dog', 'An animal kept as a pet.'),
      await sense('canine', 'An animal of the dog family.'),
      await sense('animal', 'A living creature.'),
      await sense('head', 'The top part of the body.'),
    ]
    const relation = (subject: string, type: string, target: string) =>
      submitFact(token, { kind: 'relation', subject_id: subject, payload: { type, target_sense_id: target } })
    const taxon = await relation(dog, 'hypernym', canine)
    const category = await relation(dog, 'hypernym', animal)
    const part = await relation(head, 'part_of', animal)
    const curated = await relation(canine, 'hypernym', animal)
    await settle()
    await env.DB.prepare(`update facts set review = json_set(review, '$.reviewer', 'curator') where id = ?`)
      .bind(curated.id)
      .run()
    await env.DB.prepare('update worklist set scored_revision = revision').run()
    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name.endsWith('_relation_layer_review.sql'))
    if (!migration) throw new Error('The relation_layer_review migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()
    const marked = (id: string) =>
      env.DB.prepare('select status, revalidate_since is not null as marked from facts where id = ?').bind(id).first()
    expect(await marked(taxon.id)).toEqual({ status: 'published', marked: 0 })
    expect(await marked(category.id)).toEqual({ status: 'published', marked: 1 })
    expect(await marked(part.id)).toEqual({ status: 'published', marked: 1 })
    expect(await marked(curated.id)).toEqual({ status: 'published', marked: 0 })
    const corrections = await env.DB.prepare(
      'select subject_id, object_id, content_key, payload, status, author from facts where supersedes_id is not null',
    ).all()
    expect(corrections.results).toEqual([
      {
        subject_id: dog,
        object_id: canine,
        content_key: `hypernym|${canine}|biology`,
        payload: JSON.stringify({ type: 'hypernym', target_sense_id: canine, domain: 'biology' }),
        status: 'pending',
        author: 'admin:migration',
      },
    ])
    const supersedes = await env.DB.prepare('select supersedes_id from facts where supersedes_id is not null').first()
    expect(supersedes).toEqual({ supersedes_id: taxon.id })
    const fresh = await env.DB.prepare(
      'select count(*) as n, sum(revision = scored_revision) as fresh from worklist',
    ).first()
    expect(fresh).toEqual({ n: 4, fresh: 0 })
  })
})
