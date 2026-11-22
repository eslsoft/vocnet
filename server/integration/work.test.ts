import { env } from 'cloudflare:test'
import { leaseStatement, nextTypeStatement } from '@server/adapters/repos/work'
import { createDb } from '@server/db/client'
import type { PrincipalRef } from '@server/domain/principal'
import { coreImportResultSchema, createEntryResultSchema, managedEntrySchema } from '@shared/catalog'
import { apiErrorSchema } from '@shared/types'
import { type WorkLeaseId, type WorkType, workClaimSchema } from '@shared/work'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adminToken,
  admit,
  call,
  claim,
  complete,
  curated,
  headword,
  importLearnerData,
  issueAgentKey,
  managed,
  publishInventory,
  reviewPending,
  submitOk,
} from './helpers'

const codeOf = (body: unknown) => apiErrorSchema.parse(body).error.code
const claimRaw = (token: string, json?: unknown) => call('/manage/v1/work/claim', { method: 'POST', token, json })
const completeRaw = (token: string, leaseId: string, json: unknown = { items: [] }) =>
  call(`/manage/v1/work/${leaseId}/complete`, { method: 'POST', token, json })
const lemmasOf = async (token: string, types: WorkType[], limit = 10) =>
  (await claim(token, { types, limit }))?.items.map((item) => item.lemma) ?? null
const expireLeases = () =>
  Promise.all([
    env.DB.prepare('update work_items set lease_expires_at = ? where lease_id is not null')
      .bind(new Date(Date.now() - 1000).toISOString())
      .run(),
    env.DB.prepare('update work_leases set expires_at = ?')
      .bind(new Date(Date.now() - 1000).toISOString())
      .run(),
  ])
/** The stored work items of an entry, as its last rescore wrote them: type and node. */
const itemsOf = async (entryId: string) =>
  (
    await env.DB.prepare(
      'select type, subject_id, attempts from work_items where entry_id = ? order by type, subject_id',
    )
      .bind(entryId)
      .all<{ type: string; subject_id: string; attempts: number }>()
  ).results
const typesAt = async (entryId: string, subjectId: string) =>
  (await itemsOf(entryId)).filter((item) => item.subject_id === subjectId).map((item) => item.type)
const rowOf = (entryId: string) =>
  env.DB.prepare('select revision = scored_revision as fresh, completeness from worklist where entry_id = ?')
    .bind(entryId)
    .first<{ fresh: number; completeness: number }>()

const NOUN = { pos: 'noun', gloss: 'The regular rise and fall of the sea.' } as const

describe('work items', () => {
  afterEach(() => vi.restoreAllMocks())

  it('claims items of one type with their context and completes them [spec: work/claim-api]', async () => {
    const holder = await issueAgentKey('holder')
    const other = await issueAgentKey('other')
    const tide = await admit('tide')
    expect((await call('/manage/v1/work/claim', { method: 'POST' })).status).toBe(401)

    const work = await claim(holder, { lease_seconds: 600 })
    expect(work?.lease).toMatchObject({ type: 'senses', holder: expect.stringMatching(/^agent:/) })
    expect(Date.parse(work?.lease.expires_at ?? '') - Date.now()).toBeGreaterThan(590_000)
    expect(work?.items).toHaveLength(1)
    const [item] = work?.items ?? []
    expect(item).toMatchObject({
      type: 'senses',
      entry_id: tide,
      lemma: 'tide',
      subject_id: tide,
      stage: 1,
      attempts: 0,
      gap: { type: 'senses' },
      context: {
        entry: { id: tide, lemma: 'tide', cefr: [], zipf: null, senses: [] },
        sense: null,
        related: [],
        rejections: [],
      },
    })
    const view = managedEntrySchema.parse((await call('/manage/v1/entries/tide', { token: holder })).body)
    expect(item?.context.view).toEqual(view)

    // The only item is leased: the other agent gets nothing and cannot complete the holder's lease.
    expect(await claim(other)).toBeNull()
    const stolen = await completeRaw(other, work?.lease.id as string)
    expect([stolen.status, codeOf(stolen.body)]).toEqual([409, 'conflict'])
    await admit('cove')
    const next = await claim(other)
    const foreign = await completeRaw(holder, work?.lease.id as string, { items: [{ id: next?.items[0]?.id }] })
    expect([foreign.status, codeOf(foreign.body)]).toEqual([422, 'invalid_reference'])

    const done = await complete(holder, work?.lease.id as string, [{ id: item?.id as string, note: 'Looked.' }])
    expect(done).toEqual({ lease_id: work?.lease.id, items: [{ id: item?.id, state: 'open', attempts: 1 }] })
    const again = await completeRaw(holder, work?.lease.id as string)
    expect([again.status, codeOf(again.body)]).toEqual([404, 'not_found'])
  })

  it('rejects a claim body outside its bounds', async () => {
    const token = await issueAgentKey()
    for (const json of [{ lease_seconds: 59 }, { limit: 0 }, { limit: 51 }, { types: ['sense_list'] }, { types: [] }]) {
      const result = await claimRaw(token, json)
      expect([result.status, codeOf(result.body)]).toEqual([400, 'invalid_request'])
    }
  })

  it('carries in each claimed item the standard its facts are reviewed by [spec: work/claim-criteria-api]', async () => {
    const token = await issueAgentKey()
    await headword('oven', [{ pos: 'noun', gloss: 'A box for cooking food in.' }])
    const topics = await claim(token, { types: ['topics'] })
    const criteria = topics?.items[0]?.context.criteria
    expect(criteria?.fills.map((fill) => [fill.kind, fill.decision?.models])).toEqual([['topic', ['jev', 'luna']]])
    expect(criteria?.fills[0]?.decision?.rule).toContain('mean score of jev and luna')
    expect(criteria?.fills[0]?.rubric).toContain('Topic: "<topic>" (in the category "<category>").')
    expect(JSON.stringify(criteria)).toContain('Houses and homes')
    expect(criteria?.limits).toContainEqual(expect.stringContaining('Only a published fact can be superseded'))
    const synonyms = await claim(token, { types: ['synonyms'] })
    const [synonym] = synonyms?.items[0]?.context.criteria.fills ?? []
    expect(synonym?.kind).toBe('relation')
    expect(synonym?.decision?.models).toEqual(['jev'])
    expect(synonym?.decision?.rule).toContain('jev 0.70')
  })

  it('gives concurrent claims distinct items [spec: work/claim-race]', async () => {
    const tokens = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((name) => issueAgentKey(name)))
    const lemmas = ['bay', 'cove', 'fjord']
    for (const lemma of lemmas) await headword(lemma, [NOUN])
    const results = await Promise.all(tokens.map((token) => claimRaw(token, { types: ['syllables'], limit: 1 })))
    const won = results.filter((result) => result.status === 200).map((result) => workClaimSchema.parse(result.body))
    expect(won.flatMap((work) => work.items.map((item) => item.lemma)).sort()).toEqual(lemmas)
    expect(results.filter((result) => result.status === 204)).toHaveLength(2)
  })

  it('hands each expired lease to exactly one of the claims racing for it [spec: work/claim-expired-race]', async () => {
    const tokens = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((name) => issueAgentKey(name)))
    for (const lemma of ['bay', 'cove', 'fjord']) await headword(lemma, [NOUN])
    for (const token of tokens.slice(0, 3)) expect(await lemmasOf(token, ['syllables'], 1)).toHaveLength(1)
    expect(await claim(tokens[3] as string, { types: ['syllables'], limit: 1 })).toBeNull()
    await expireLeases()
    const results = await Promise.all(tokens.map((token) => claimRaw(token, { types: ['syllables'], limit: 1 })))
    const won = results.filter((result) => result.status === 200).map((result) => workClaimSchema.parse(result.body))
    expect(won.flatMap((work) => work.items.map((item) => item.lemma)).sort()).toEqual(['bay', 'cove', 'fjord'])
    expect(new Set(won.map((work) => work.lease.holder)).size).toBe(3)
  })

  it('lets another agent claim an expired lease, which its holder can no longer complete [spec: work/lease-expiry-api]', async () => {
    const first = await issueAgentKey('first')
    const second = await issueAgentKey('second')
    await headword('tide', [NOUN])
    const lapsed = await claim(first, { types: ['syllables'] })
    await expireLeases()
    const late = await completeRaw(first, lapsed?.lease.id as string)
    expect([late.status, codeOf(late.body)]).toEqual([409, 'conflict'])
    const taken = await claim(second, { types: ['syllables'] })
    expect(taken?.items.map((item) => item.id)).toEqual(lapsed?.items.map((item) => item.id))
    expect((await completeRaw(second, taken?.lease.id as string)).status).toBe(200)
  })

  it('orders items by batch, then A1 to C2, then frequency without a level, then the rest, re-ranked by every import [spec: work/claim-priority]', async () => {
    const token = await issueAgentKey()
    for (const lemma of ['reef', 'wave', 'tide', 'cove', 'Bank', 'sea']) await admit(lemma, 1)
    const data = {
      zipf: { bank: 5, cove: 3, tide: 4, wave: 4.5, shore: 6, dune: 7 },
      levels: { Bank: 'A1', cove: 'A1', sea: 'A1', tide: 'B2', shore: 'B1', dune: 'A1' } as const,
    }
    // The import re-ranks the items that exist; the later admissions read the rows their creation wrote.
    await importLearnerData(data)
    await admit('shore', 1)
    await admit('dune', 2)
    // Bank has the frequency of its word form, "bank"; sea has a level but no frequency; dune waits for batch 2.
    expect(await lemmasOf(token, ['senses'])).toEqual(['Bank', 'cove', 'sea', 'shore', 'tide', 'wave', 'reef', 'dune'])
    // A reimport re-ranks: reef becomes batch 1's one A1 entry and comes first once the leases lapse, then
    // the most frequent entry without a level; dune, A1 too, still waits for batch 2.
    await importLearnerData({ zipf: data.zipf, levels: { reef: 'A1', dune: 'A1' } })
    await expireLeases()
    expect(await lemmasOf(token, ['senses'], 2)).toEqual(['reef', 'shore'])
  })

  it('finishes the more frequent word of a band before starting the next, whatever the stage [spec: work/claim-priority]', async () => {
    const token = await issueAgentKey()
    await importLearnerData({ zipf: { bank: 5, cove: 3 }, levels: { bank: 'A1', cove: 'A1' } })
    // bank has its inventory, so its later stages are open; cove still needs its first.
    await headword('bank', [{ pos: 'noun', gloss: 'An organization that keeps and lends money.' }])
    await admit('cove', 1)
    const first = await claim(token, { limit: 1 })
    expect(first?.items.map((item) => [item.lemma, item.type === 'senses'])).toEqual([['bank', false]])
  })

  it('leases no item of an entry until it is live [spec: work/claim-live]', async () => {
    const token = await issueAgentKey()
    const { entryId: give } = await headword('give', [{ pos: 'verb', gloss: 'To hand something to someone.' }])
    const list = await curated('phrases', give, {
      phrases: [
        { type: 'phrasal_verb', text: 'give up' },
        { type: 'phrasal_verb', text: 'give in' },
      ],
    })
    expect((await managed('give up')).live).toBe(true)
    // The correction drops "give up": its entry stays, but it is no longer live and has no items.
    await curated('phrases', give, { phrases: [{ type: 'phrasal_verb', text: 'give in' }] }, list.id)
    const dropped = await managed('give up')
    expect([dropped.live, dropped.batch]).toEqual([false, 1])
    expect(await itemsOf(dropped.entry.id)).toEqual([])
    expect(await lemmasOf(token, ['senses'])).toEqual(['give in'])
    await expireLeases()
    // Admitted as a headword, it is live again and its senses item is claimable.
    await admit('give up', 1)
    expect((await lemmasOf(token, ['senses']))?.sort()).toEqual(['give in', 'give up'])
  })

  it('answers 204 once every slot is filled or passed, until a retraction reopens one [spec: work/claim-empty]', async () => {
    const token = await issueAgentKey()
    const admin = await adminToken()
    const { entryId, senses } = await headword('ice cream', [
      { pos: 'noun', gloss: 'A frozen sweet food made from milk.' },
    ])
    const sense = senses[0] as string
    await curated('pronunciation', entryId, { ipa: 'aɪs ˈkriːm', accent: 'uk' })
    await curated('pronunciation', entryId, { ipa: 'ˈaɪs kriːm', accent: 'us' })
    const example = await curated('example', sense, { text: 'The children ate ice cream.' })
    await curated('translation', sense, { language: 'zh', of: 'sense', text: '冰淇淋' })
    await curated('translation', example.object_id as string, {
      language: 'zh',
      of: 'sentence',
      text: '孩子们吃了冰淇淋。',
    })
    await curated('productive_use', entryId, { pos: 'noun', native: true, learner: true })
    for (const type of ['category', 'synonyms', 'topics', 'grammar', 'collocations']) {
      const passed = await call(`/manage/v1/entries/${entryId}/passes`, {
        method: 'POST',
        token: admin,
        json: { type, subject_id: sense, note: 'Settled for the test.' },
      })
      expect(passed.status).toBe(204)
    }
    expect(await itemsOf(entryId)).toEqual([])
    expect(await claim(token)).toBeNull()
    expect((await managed('ice cream')).completeness).toBe(1)

    expect((await call(`/manage/v1/facts/${example.id}/retract`, { method: 'POST', token: admin })).status).toBe(200)
    const reopened = await claim(token)
    expect(reopened?.items.map((item) => item.gap)).toEqual([{ type: 'examples', sense_id: sense, count: 0, need: 1 }])
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

  it('drains stale scores through the admin rescore [spec: work/rescore-api]', async () => {
    const token = await issueAgentKey()
    const admin = await adminToken()
    for (const lemma of ['bay', 'cove', 'fjord']) await admit(lemma)
    await env.DB.prepare('update worklist set revision = revision + 1').run()
    const rescore = (json: unknown, as = token) => call('/manage/v1/work/rescore', { method: 'POST', token: as, json })
    expect((await rescore({ limit: 2 })).status).toBe(403)
    expect((await rescore({ limit: 0 }, admin)).status).toBe(400)
    expect((await rescore({ limit: 2 }, admin)).body).toEqual({ rescored: 2, remaining: 1 })
    expect((await rescore({}, admin)).body).toEqual({ rescored: 1, remaining: 0 })
  })

  it('keeps the network, topic, and collocation items for the core senses only [spec: work/core-senses-api]', async () => {
    const adjective = (gloss: string) => ({ pos: 'adjective', gloss }) as const
    const verb = (gloss: string) => ({ pos: 'verb', gloss }) as const
    const entryId = await admit('clear')
    const { senses } = await publishInventory(entryId, [
      adjective('Easy to understand.'),
      adjective('Easy to see through.'),
      adjective('Free from anything that blocks the way.'),
      adjective('Without any doubt in the mind.'),
      verb('To remove things from a place.'),
      verb('To become free of clouds.'),
    ])
    const [first, second, third, fourth, firstVerb, secondVerb] = senses
    for (const core of [first, second, third]) {
      expect(await typesAt(entryId, core as string)).toEqual(['collocations', 'examples', 'grammar', 'synonyms'])
    }
    // A core verb also needs a topic; an adjective needs none.
    expect(await typesAt(entryId, firstVerb as string)).toEqual([
      'collocations',
      'examples',
      'grammar',
      'synonyms',
      'topics',
    ])
    for (const rest of [fourth, secondVerb])
      expect(await typesAt(entryId, rest as string)).toEqual(['examples', 'grammar'])
  })

  it('reopens a category slot only once no hypernym leads to a sense that can show [spec: work/relations-visible-ends-api]', async () => {
    const dogGloss = 'An animal kept as a pet or for guarding.'
    const {
      entryId: dog,
      senses: [dogSense],
    } = await headword('dog', [{ pos: 'noun', gloss: dogGloss }])
    const {
      entryId: animal,
      inventory,
      senses: [animalSense],
    } = await headword('animal', [{ pos: 'noun', gloss: 'A living thing that can move and feel.' }])
    const { entryId: domestic } = await headword('domestic', [{ pos: 'adjective', gloss: 'Kept by people at home.' }])
    const list = await curated('phrases', domestic, { phrases: [{ type: 'phrasal_verb', text: 'domestic animal' }] })
    const pet = await admit('domestic animal')
    const {
      senses: [petSense],
    } = await publishInventory(pet, [{ pos: 'noun', gloss: 'An animal that lives with people.' }])
    await curated('relation', dogSense as string, { type: 'hypernym', target_sense_id: animalSense })
    await curated('relation', dogSense as string, { type: 'hypernym', target_sense_id: petSense })
    expect(await typesAt(dog, dogSense as string)).not.toContain('category')
    expect(await typesAt(dog, dogSense as string)).toContain('parts')

    // A curator's correction of "animal" drops the target sense; the other hypernym still shows.
    await publishInventory(
      animal,
      [{ pos: 'noun', gloss: 'A creature that is not a bird, fish, or insect.' }],
      inventory.id,
    )
    expect((await rowOf(dog))?.fresh).toBe(1)
    expect(await typesAt(dog, dogSense as string)).not.toContain('category')
    // "domestic animal" leaves the dictionary: no hypernym can show, so the category opens and the parts close.
    await curated('phrases', domestic, { phrases: [{ type: 'phrasal_verb', text: 'domestic help' }] }, list.id)
    expect((await managed('domestic animal')).live).toBe(false)
    expect((await rowOf(dog))?.fresh).toBe(1)
    const types = await typesAt(dog, dogSense as string)
    expect(types).toContain('category')
    expect(types).not.toContain('parts')
  })

  it('names every item of the entry in one language and reopens a rejected one [spec: work/translations-api]', async () => {
    const token = await issueAgentKey()
    const { entryId, senses } = await headword('tide', [NOUN])
    const sense = senses[0] as string
    const example = await curated('example', sense, { text: 'The tide came in fast.' })
    const collocation = await curated('collocation', sense, { text: 'high tide', pattern: 'adjective_noun' })
    const work = await claim(token, { types: ['translations'] })
    const [item] = work?.items ?? []
    expect(item?.gap).toEqual({
      type: 'translations',
      language: 'zh',
      missing: [
        { of: 'sense', id: sense },
        { of: 'sentence', id: example.object_id },
        { of: 'collocation', id: collocation.id },
      ],
    })
    expect(item?.context.view?.entry.id).toBe(entryId)
    const translations = [
      await submitOk(token, 'translation', sense, { language: 'zh', of: 'sense', text: '潮汐' }),
      await submitOk(token, 'translation', example.object_id as string, {
        language: 'zh',
        of: 'sentence',
        text: '潮水涨得很快。',
      }),
      await submitOk(token, 'translation', collocation.id, { language: 'zh', of: 'collocation', text: '满潮' }),
    ]
    expect((await complete(token, work?.lease.id as string, [{ id: item?.id as string }])).items[0]?.state).toBe(
      'awaiting_review',
    )
    // The LLM alone judges the collocation translation and fails it; Jev and luna pass the equivalent.
    await reviewPending({ verdict: 'fail' })
    const statuses = await Promise.all(
      translations.map(
        async (fact) => ((await call(`/manage/v1/facts/${fact.id}`, { token })).body as { status: string }).status,
      ),
    )
    expect(statuses).toEqual(['published', 'rejected', 'rejected'])
    const retry = await claim(token, { types: ['translations'] })
    expect(retry?.items[0]).toMatchObject({
      attempts: 0,
      gap: {
        missing: [
          { of: 'sentence', id: example.object_id },
          { of: 'collocation', id: collocation.id },
        ],
      },
    })
    await submitOk(token, 'translation', example.object_id as string, {
      language: 'zh',
      of: 'sentence',
      text: '潮水来得很快。',
    })
    await submitOk(token, 'translation', collocation.id, { language: 'zh', of: 'collocation', text: '高潮位' })
    await complete(token, retry?.lease.id as string, [{ id: retry?.items[0]?.id as string }])
    await reviewPending()
    expect((await itemsOf(entryId)).map((row) => row.type)).not.toContain('translations')
  })

  it('brings a rejected inventory back once with its review, then hands the item to a curator [spec: work/inventory-retry]', async () => {
    const token = await issueAgentKey()
    const entryId = await admit('tide')
    const first = await claim(token, { types: ['senses'] })
    const rejected = await submitOk(token, 'senses', entryId, {
      senses: [{ pos: 'noun', gloss: 'A wave of the sea.', rank: 'common' }],
    })
    expect(
      (await complete(token, first?.lease.id as string, [{ id: first?.items[0]?.id as string }])).items[0]?.state,
    ).toBe('awaiting_review')
    await reviewPending({ jev: 0.2, verdict: 'fail' })
    const second = await claim(token, { types: ['senses'] })
    expect(second?.items[0]?.attempts).toBe(1)
    expect(second?.items[0]?.context.rejections).toMatchObject([
      { id: rejected.id, status: 'rejected', review: { verdict: 'fail', reason: expect.any(String) } },
    ])
    await submitOk(token, 'senses', entryId, {
      senses: [{ pos: 'noun', gloss: 'A current of the sea.', rank: 'common' }],
    })
    await complete(token, second?.lease.id as string, [{ id: second?.items[0]?.id as string, note: 'Reworded.' }])
    await reviewPending({ jev: 0.2, verdict: 'fail' })
    expect(await claim(token, { types: ['senses'] })).toBeNull()
    const tickets = (await call('/manage/v1/tickets?status=open&type=stuck_work', { token: await adminToken() }))
      .body as {
      items: Array<{ target: string; message: string }>
    }
    expect(tickets.items).toEqual([expect.objectContaining({ target: entryId, message: 'senses: Reworded.' })])
  })

  it('judges a worked item once its facts are reviewed, so a rejection after the lease counts the attempt [spec: work/item-review-api]', async () => {
    const token = await issueAgentKey()
    const { entryId } = await headword('tide', [NOUN])
    const work = await claim(token, { types: ['syllables'] })
    const syllables = await submitOk(token, 'syllables', entryId, { syllables: ['tide'] })
    expect((await complete(token, work?.lease.id as string, [{ id: work?.items[0]?.id as string }])).items).toEqual([
      { id: work?.items[0]?.id, state: 'awaiting_review', attempts: 0 },
    ])
    expect(await claim(token, { types: ['syllables'] })).toBeNull()
    await reviewPending({ luna: 0.2, verdict: 'fail' })
    const back = await claim(token, { types: ['syllables'] })
    expect(back?.items[0]?.attempts).toBe(1)
    expect(back?.items[0]?.context.rejections.map((fact) => [fact.id, fact.status])).toEqual([
      [syllables.id, 'rejected'],
    ])
  })

  it('passes optional slots with found_none and a note, recording the words they were blocked on [spec: work/found-none-api]', async () => {
    const token = await issueAgentKey()
    const { entryId, senses } = await headword('tide', [NOUN])
    const before = (await managed('tide')).completeness
    const phrases = await claim(token, { types: ['phrases'] })
    const item = phrases?.items[0]?.id as string
    const bare = await completeRaw(token, phrases?.lease.id as string, { items: [{ id: item, found_none: true }] })
    expect([bare.status, codeOf(bare.body)]).toEqual([400, 'invalid_request'])
    const done = await complete(token, phrases?.lease.id as string, [
      { id: item, found_none: true, note: 'No learner dictionary prints a phrase of tide.' },
    ])
    expect(done.items).toEqual([{ id: item, state: 'closed', attempts: 0 }])
    expect((await managed('tide')).completeness).toBeGreaterThan(before)

    const synonyms = await claim(token, { types: ['synonyms'] })
    const synonym = synonyms?.items[0]?.id as string
    const passed = await complete(token, synonyms?.lease.id as string, [
      { id: synonym, found_none: true, note: 'Only "flow" fits, and it is no entry.', blocked_on: ['flow'] },
    ])
    expect(passed.items[0]?.state).toBe('closed')
    expect(await typesAt(entryId, senses[0] as string)).not.toContain('synonyms')
    const blocks = await env.DB.prepare('select lemma, type, subject_id from work_pass_blocks').all()
    expect(blocks.results).toEqual([{ lemma: 'flow', type: 'synonyms', subject_id: senses[0] }])
  })

  it('refuses found_none and blocked_on on a required slot [spec: work/required-slot-api]', async () => {
    const token = await issueAgentKey()
    await headword('tide', [NOUN])
    const work = await claim(token, { types: ['syllables'] })
    const id = work?.items[0]?.id as string
    for (const item of [
      { id, found_none: true, note: 'Nothing.' },
      { id, blocked_on: ['tides'] },
    ]) {
      const refused = await completeRaw(token, work?.lease.id as string, { items: [item] })
      expect([refused.status, codeOf(refused.body)]).toEqual([400, 'invalid_request'])
    }
    expect(
      (await complete(token, work?.lease.id as string, [{ id, note: 'Could not divide it.' }])).items[0]?.state,
    ).toBe('open')
  })

  it('reopens a passed slot when a curator admits a word it was blocked on [spec: work/blocked-reopen-api]', async () => {
    const token = await issueAgentKey()
    const { entryId, senses } = await headword('huge', [{ pos: 'adjective', gloss: 'Very large in size.' }])
    const sense = senses[0] as string
    const work = await claim(token, { types: ['synonyms'] })
    await complete(token, work?.lease.id as string, [
      { id: work?.items[0]?.id as string, found_none: true, note: 'Only "enormous" fits.', blocked_on: ['enormous'] },
    ])
    expect(await typesAt(entryId, sense)).not.toContain('synonyms')
    await admit('vast')
    expect(await typesAt(entryId, sense)).not.toContain('synonyms')
    await admit('enormous')
    expect((await itemsOf(entryId)).filter((item) => item.type === 'synonyms')).toEqual([
      { type: 'synonyms', subject_id: sense, attempts: 0 },
    ])
    expect((await claim(token, { types: ['synonyms'] }))?.items.map((item) => item.subject_id)).toContain(sense)
  })

  it('opens a stuck_work ticket after two passes leave an item unfilled, which a curator settles [spec: work/stuck-ticket-api]', async () => {
    const producer = await issueAgentKey('producer')
    const curator = await issueAgentKey('curator', true)
    const { entryId } = await headword('tide', [NOUN])
    for (const attempts of [1, 2]) {
      const work = await claim(producer, { types: ['syllables'] })
      const done = await complete(producer, work?.lease.id as string, [
        { id: work?.items[0]?.id as string, note: 'Unsure.' },
      ])
      expect(done.items[0]).toMatchObject({ state: attempts === 2 ? 'ticket' : 'open', attempts })
    }
    expect(await claim(producer, { types: ['syllables'] })).toBeNull()
    const listed = (await call('/manage/v1/tickets?type=stuck_work', { token: curator })).body as {
      items: Array<{ type: string; target_type: string; target: string; message: string; status: string }>
    }
    expect(listed.items).toEqual([
      expect.objectContaining({
        type: 'stuck_work',
        target_type: 'entry',
        target: entryId,
        message: 'syllables: Unsure.',
        status: 'open',
      }),
    ])
    const settle = (token: string) =>
      call(`/manage/v1/entries/${entryId}/passes`, {
        method: 'POST',
        token,
        json: { type: 'syllables', subject_id: entryId, note: 'One syllable; nothing to divide.' },
      })
    expect((await settle(producer)).status).toBe(403)
    expect((await settle(curator)).status).toBe(204)
    expect((await itemsOf(entryId)).map((item) => item.type)).not.toContain('syllables')
  })

  it('opens a family gap on an A1 word that a derivative naming it as a base fills in the same request [spec: work/family-api]', async () => {
    const token = await issueAgentKey()
    await importLearnerData({ levels: { happy: 'A1' } })
    const { entryId: happy } = await headword('happy', [{ pos: 'adjective', gloss: 'Feeling pleasure.' }])
    const work = await claim(token, { types: ['family'] })
    expect(work?.items.map((item) => [item.lemma, item.gap])).toEqual([['happy', { type: 'family' }]])
    await complete(token, work?.lease.id as string, [])
    const open = await rowOf(happy)
    const { entryId: happiness } = await headword('happiness', [{ pos: 'noun', gloss: 'The state of feeling happy.' }])
    const parts = [
      { form: 'happy', role: 'base', lemma: 'happy' },
      { form: '-ness', role: 'suffix' },
    ]
    const submit = (payload: unknown) =>
      call('/manage/v1/facts', { method: 'POST', token, json: { kind: 'morphology', subject_id: happiness, payload } })
    const unknown = await submit({ parts: [{ form: 'happy', role: 'base', lemma: 'Happy' }, parts[1]] })
    expect(unknown.status).toBe(422)
    expect(apiErrorSchema.parse(unknown.body).error.message).toContain('blocked_on')
    expect((await submit({ parts: [parts[0], { form: '-ness', role: 'suffix', lemma: 'happy' }] })).status).toBe(400)
    const formation = await submit({ parts })
    expect(formation.status).toBe(201)
    const filled = await rowOf(happy)
    expect(filled?.fresh).toBe(1)
    expect(filled?.completeness).toBeGreaterThan(open?.completeness ?? 1)
    await reviewPending()
    const view = (await call('/v1/entries/happiness')).body as { morphology: { parts: unknown[] } | null }
    expect(view.morphology?.parts[0]).toEqual({ form: 'happy', role: 'base', lemma: 'happy' })
    // Retracting the derivative's formation reopens the base's gap.
    const id = (formation.body as { fact: { id: string } }).fact.id
    expect((await call(`/manage/v1/facts/${id}/retract`, { method: 'POST', token })).status).toBe(200)
    expect((await rowOf(happy))?.completeness).toBe(open?.completeness)
  })
})

describe('headword admission', () => {
  afterEach(() => vi.restoreAllMocks())

  it('admits the CEFR headwords without an entry as batch 1, for admins only, their senses items first [spec: catalog/import-core-api]', async () => {
    await importLearnerData({
      zipf: { bank: 5, the: 7 },
      levels: { bank: 'A1', 'according to': 'B1', x: 'A1', the: 'A1' },
    })
    await admit('the', 2)
    const agent = await issueAgentKey()
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
    const skipped = { letters: ['x'], contractions: [], characters: [], inflections: [], variants: [] }
    expect(results).toEqual([
      { created: ['bank'], skipped, remaining: 1 },
      { created: ['according to'], skipped, remaining: 0 },
      { created: [], skipped, remaining: 0 },
    ])
    const batches = await Promise.all(
      ['bank', 'according to', 'the'].map(async (lemma) => (await managed(lemma)).batch),
    )
    expect(batches).toEqual([1, 1, 2])
    expect((await managed('bank')).live).toBe(true)
    expect((await call('/manage/v1/entries/x', { token: agent })).status).toBe(404)
    // Nothing is queued for review: an admitted headword has no fact.
    expect(
      ((await call('/manage/v1/facts?status=pending', { token: admin })).body as { items: unknown[] }).items,
    ).toEqual([])
    // "the" is A1 and more frequent but batch 2, so the batch 1 headwords come first.
    expect(await lemmasOf(agent, ['senses'])).toEqual(['bank', 'according to', 'the'])
  })

  it('takes an entry off the wordlist for curators, unless a published list names it [spec: catalog/retire-api]', async () => {
    const curator = await issueAgentKey('curator', true)
    const producer = await issueAgentKey('producer')
    const { entryId } = await headword('fabulate', [{ pos: 'verb', gloss: 'To make up a story.' }])
    const retire = (token: string, id: string) => call(`/manage/v1/entries/${id}/retire`, { method: 'POST', token })
    const denied = await retire(producer, entryId)
    expect([denied.status, codeOf(denied.body)]).toEqual([403, 'forbidden'])
    const done = await retire(curator, entryId)
    expect([done.status, (done.body as { retired: boolean }).retired]).toEqual([200, true])
    expect((await managed('fabulate')).live).toBe(false)
    expect((await call('/v1/entries/fabulate')).status).toBe(404)
    expect((await lemmasOf(producer, ['examples', 'translations'])) ?? []).not.toContain('fabulate')
    expect((await retire(curator, crypto.randomUUID())).status).toBe(404)
    const give = await headword('give', [{ pos: 'verb', gloss: 'To hand something to someone.' }])
    await curated('phrases', give.entryId, { phrases: [{ type: 'phrasal_verb', text: 'give up' }] })
    const named = await retire(curator, (await managed('give up')).entry.id)
    expect([named.status, codeOf(named.body)]).toEqual([409, 'conflict'])
    await admit('fabulate', 1)
    expect((await managed('fabulate')).live).toBe(true)
  })

  it('admits a headword only for a curator, idempotently by lemma [spec: catalog/create-entry-api]', async () => {
    const producer = await issueAgentKey('producer')
    const curator = await issueAgentKey('curator', true)
    const post = (token: string) =>
      call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'house', batch: 2 } })
    const refused = await post(producer)
    expect([refused.status, codeOf(refused.body)]).toEqual([403, 'forbidden'])
    const created = await post(curator)
    expect(created.status).toBe(201)
    const { entry, created: fresh } = createEntryResultSchema.parse(created.body)
    expect([entry.lemma, fresh]).toEqual(['house', true])
    const again = await post(curator)
    expect([again.status, createEntryResultSchema.parse(again.body).entry.id]).toEqual([200, entry.id])
    expect((await post(await adminToken())).status).toBe(200)
    const view = await managed('house')
    expect([view.live, view.batch]).toEqual([true, 2])
    expect((await claim(producer))?.items.map((item) => [item.lemma, item.type])).toEqual([['house', 'senses']])
  })
})
