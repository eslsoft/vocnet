import { admin, agentA, agentB, curatorAgent } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import type { EntryId, SenseId } from '@shared/facts'
import type { ClaimWorkInput, WorkItemId, WorkLeaseId, WorkType } from '@shared/work'
import { describe, expect, it } from 'vitest'
import { createEntry, createSense } from './catalog'
import { submitFact } from './facts'
import { reviewFact } from './review'
import { claimWork, completeWork, EXPIRED_LEASE_RETENTION_MS, listCurationItems, purgeExpiredLeases } from './work'
import { refreshStaleWork, rescoreStaleWork } from './work-scores'

const start = '2026-01-01T00:00:00.000Z'

type World = ReturnType<typeof fakeWorld>

/** Lets every pending review land with the reviewers' current answers. */
async function settle(world: World) {
  for (const fact of world.facts.filter((candidate) => candidate.status === 'pending')) {
    await reviewFact(world.deps, fact.id, 'trace')
  }
}

const level = (zipf: number, cefr: 'A1' | 'B1' | 'C2') => ({
  frequency: { zipf, rank: 1, source_id: 'wordfreq' },
  cefr: [{ pos: 'noun' as const, level: cefr, source_id: 'cefrj' }],
})

async function worldWith(lemmas: Record<string, ReturnType<typeof level> | null>) {
  const world = fakeWorld()
  world.referenceSources.push({
    id: 'cefrj',
    name: 'CEFR-J Wordlist',
    version: '1.6',
    license: 'Custom',
    license_url: 'https://www.cefr-j.org/download.html',
    changes: 'None.',
    attribution: 'CEFR-J',
    url: 'https://www.cefr-j.org/',
    retrieved_at: '2026-11-09',
  })
  const entries: EntryId[] = []
  for (const [index, [lemma, reference]] of Object.entries(lemmas).entries()) {
    if (reference) world.references.set(lemma, reference)
    world.setNow(`2026-01-01T00:00:0${index}.000Z`)
    entries.push((await createEntry(world.deps, agentA, { lemma })).entry.id)
  }
  world.setNow(start)
  await settle(world)
  return { world, entries }
}

const claim = (world: World, input: Partial<ClaimWorkInput> = {}, actor = agentA) =>
  claimWork(world.deps, actor, { limit: 10, ...input })

/** A published noun sense on the entry. */
async function noun(world: World, entryId: EntryId, gloss: string): Promise<SenseId> {
  const { sense } = await createSense(world.deps, agentA, { entry_id: entryId, pos: 'noun', gloss })
  await settle(world)
  return sense.id
}

const itemOf = (world: World, type: WorkType) => world.items.find((item) => item.type === type)
/** A review that never answers, so the facts it is asked about stay pending. */
const holdReviews = (world: World) => world.answerLlm(() => new Promise(() => {}))

describe('claimWork', () => {
  it('leases the items of the highest-priority type only, within the types asked, in learner order [spec: work/claim-one-type]', async () => {
    const { world } = await worldWith({ eagle: level(4, 'B1'), dog: level(5, 'A1'), owl: level(3, 'C2') })
    // Identity first: every entry without senses, A1 before B1 before C2.
    const senses = await claim(world, { limit: 2 })
    expect(senses?.lease.type).toBe('senses')
    expect(senses?.items.map(({ lemma }) => lemma)).toEqual(['dog', 'eagle'])
    expect(senses?.items[0]?.context.view?.entry.lemma).toBe('dog')
    // Asking only for pronunciation leases that type, though senses would come first.
    const sounds = await claim(world, { types: ['pronunciation'], limit: 50 }, agentB)
    expect(sounds?.lease.type).toBe('pronunciation')
    expect(sounds?.items.map(({ lemma }) => lemma)).toEqual(['dog', 'eagle', 'owl'])
    expect(sounds?.items[0]?.context).toMatchObject({ sense: null, view: null, entry: { lemma: 'dog', zipf: 5 } })
    // The A1 dog finishes every stage before the C2 owl's senses, and nobody else gets the two leased
    // senses items meanwhile: each lease before the owl's senses starts with the dog's item.
    const before: string[] = []
    for (let lease = await claim(world, {}, agentB); lease; lease = await claim(world, {}, agentB)) {
      if (lease.lease.type === 'senses') {
        expect(lease.items.map(({ lemma }) => lemma)).toEqual(['owl'])
        break
      }
      before.push(lease.items[0]?.lemma ?? '')
    }
    expect(before.length).toBeGreaterThan(0)
    expect(new Set(before)).toEqual(new Set(['dog']))
    expect(await claim(world, { types: ['pronunciation'] }, agentB)).toBeNull()
  })

  it('ranks a meaning item of any level before a usage one, and carries the sense context [spec: work/claim-context]', async () => {
    const { world, entries } = await worldWith({ eagle: level(4, 'C2'), bird: level(5, 'A1') })
    const [eagle, bird] = entries as [EntryId, EntryId]
    const eagleSense = await noun(world, eagle, 'A large bird of prey.')
    const birdSense = await noun(world, bird, 'An animal with feathers and wings.')
    await submitFact(world.deps, agentA, {
      kind: 'sense_list',
      subject_id: eagle,
      payload: { common: [eagleSense], extra: [] },
    })
    await submitFact(world.deps, agentA, {
      kind: 'sense_list',
      subject_id: bird,
      payload: { common: [birdSense], extra: [] },
    })
    await settle(world)
    const categories = await claim(world, { types: ['category', 'examples'] })
    // Network work comes before usage: the category type is leased, the A1 bird's before the C2 eagle's.
    expect(categories?.lease.type).toBe('category')
    expect(categories?.items.map(({ lemma }) => lemma)).toEqual(['bird', 'eagle'])
    const eagleItem = categories?.items[1]
    expect(eagleItem?.item.gap).toEqual({ type: 'category', sense_id: eagleSense })
    expect(eagleItem?.context).toMatchObject({
      entry: { lemma: 'eagle', cefr: [{ pos: 'noun', level: 'C2' }], senses: [{ id: eagleSense, rare: false }] },
      sense: { id: eagleSense, gloss: 'A large bird of prey.', status: 'published' },
      view: null,
      related: [],
    })
    expect(eagleItem?.context.facts.map((fact) => fact.kind)).toEqual(['sense'])
  })

  it("serves no item a pending fact may change, while the entry's other items stay workable [spec: work/item-awaiting]", async () => {
    const { world, entries } = await worldWith({ bank: null })
    holdReviews(world)
    await submitFact(world.deps, agentA, {
      kind: 'pronunciation',
      subject_id: entries[0] as EntryId,
      payload: { ipa: 'bæŋk', accent: 'us' },
    })
    expect(itemOf(world, 'pronunciation')).toMatchObject({ awaiting: true })
    expect(await claim(world, { types: ['pronunciation'] })).toBeNull()
    expect((await claim(world, { types: ['syllables'] }))?.items).toHaveLength(1)
  })
})

describe('completeWork', () => {
  it('counts an attempt when a pass leaves the gap as claimed, and moves the item to the curators after three [spec: work/item-attempts-usecase]', async () => {
    const { world, entries } = await worldWith({ dawn: null })
    const passOver = async (type: WorkType) => {
      const lease = await claim(world, { types: [type] })
      const id = lease?.items[0]?.item.id as WorkItemId
      return completeWork(world.deps, agentA, lease?.lease.id as WorkLeaseId, {
        items: [{ id, note: 'Nothing found.' }],
      })
    }
    expect((await passOver('syllables')).items).toEqual([{ id: expect.any(String), state: 'open', attempts: 1 }])
    expect((await passOver('syllables')).items[0]).toMatchObject({ state: 'open', attempts: 2 })
    expect((await passOver('syllables')).items[0]).toMatchObject({ state: 'curation', attempts: 3 })
    expect(await claim(world, { types: ['syllables'] })).toBeNull()
    await expect(listCurationItems(world.deps, agentA, null, { limit: 10 })).rejects.toMatchObject({
      code: 'forbidden',
    })
    const queue = await listCurationItems(world.deps, curatorAgent, 'syllables', { limit: 10 })
    expect(queue.items).toMatchObject([
      { type: 'syllables', lemma: 'dawn', attempts: 3, lastNote: 'Nothing found.', lastWorkedBy: 'agent:agent-a' },
    ])
    expect((await listCurationItems(world.deps, admin, 'senses', { limit: 10 })).items).toEqual([])
    // A curator's fact fills the slot, which closes the item.
    await submitFact(world.deps, curatorAgent, {
      kind: 'syllables',
      subject_id: entries[0] as EntryId,
      payload: { syllables: ['dawn'] },
      curation: { reason: 'One syllable.' },
    })
    expect(itemOf(world, 'syllables')).toBeUndefined()
  })

  it('judges a worked item once its facts are reviewed: a rejection counts the attempt, a pass moves it on [spec: work/item-review-verdict]', async () => {
    const { world, entries } = await worldWith({ dawn: null })
    const passWith = async (ipa: string) => {
      const lease = await claim(world, { types: ['pronunciation'] })
      const id = lease?.items[0]?.item.id as WorkItemId
      await submitFact(world.deps, agentA, {
        kind: 'pronunciation',
        subject_id: entries[0] as EntryId,
        payload: { ipa, accent: 'us' },
      })
      return completeWork(world.deps, agentA, lease?.lease.id as WorkLeaseId, { items: [{ id }] })
    }
    // The pending pronunciation fills the us accent only once it publishes: the item waits for it.
    holdReviews(world)
    expect((await passWith('dɔːn')).items[0]).toMatchObject({ state: 'awaiting_review', attempts: 0 })
    world.failReviews()
    await settle(world)
    expect(itemOf(world, 'pronunciation')).toMatchObject({ attempts: 1, awaiting: false, worked: false })
    holdReviews(world)
    expect((await passWith('dɑːn')).items[0]).toMatchObject({ state: 'awaiting_review', attempts: 1 })
    world.passReviews()
    await settle(world)
    expect(itemOf(world, 'pronunciation')).toMatchObject({
      gap: { type: 'pronunciation', accents: ['uk'] },
      attempts: 0,
      worked: false,
    })
  })

  it('lets only the holder complete its own items before expiry, once, and releases the rest without an attempt [spec: work/complete]', async () => {
    const { world, entries } = await worldWith({ bank: null, cove: null })
    const lease = await claim(world, { types: ['syllables'] })
    const id = lease?.lease.id as WorkLeaseId
    const [bank, cove] = lease?.items ?? []
    await expect(completeWork(world.deps, agentB, id, { items: [] })).rejects.toMatchObject({ code: 'conflict' })
    await expect(completeWork(world.deps, admin, id, { items: [] })).rejects.toMatchObject({ code: 'conflict' })
    const foreign = itemOf(world, 'pronunciation')?.id as WorkItemId
    await expect(completeWork(world.deps, agentA, id, { items: [{ id: foreign }] })).rejects.toMatchObject({
      code: 'invalid_reference',
    })
    world.setNow('2026-01-01T00:05:00.000Z')
    const done = await completeWork(world.deps, agentA, id, { items: [{ id: bank?.item.id as WorkItemId }] })
    expect(done).toEqual({ leaseId: id, items: [{ id: bank?.item.id, state: 'open', attempts: 1 }] })
    expect(world.items.find((item) => item.id === cove?.item.id)).toMatchObject({ attempts: 0, lease: null })
    expect(world.work.get(entries[0] as EntryId)?.lastWorkedAt).toBe('2026-01-01T00:05:00.000Z')
    await expect(completeWork(world.deps, agentA, id, { items: [] })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('leases an item to one holder until the lease expires, then refuses the late complete [spec: work/claim-lease]', async () => {
    const { world } = await worldWith({ bank: null })
    const held = await claim(world, { types: ['syllables'] })
    expect(held?.lease.expiresAt).toBe('2026-01-01T00:15:00.000Z')
    expect(await claim(world, { types: ['syllables'] }, agentB)).toBeNull()
    world.setNow('2026-01-01T00:15:00.000Z')
    const taken = await claim(world, { types: ['syllables'] }, agentB)
    expect(taken?.lease.holder).toBe('agent:agent-b')
    const late = () => completeWork(world.deps, agentA, held?.lease.id as WorkLeaseId, { items: [] })
    await expect(late()).rejects.toMatchObject({ code: 'conflict' })
    // An expired lease is kept a day, so a late complete still learns it expired; then it is purged.
    world.setNow(new Date(Date.parse('2026-01-01T00:15:00.000Z') + EXPIRED_LEASE_RETENTION_MS).toISOString())
    expect(await purgeExpiredLeases(world.deps)).toBe(1)
    await expect(late()).rejects.toMatchObject({ code: 'not_found' })
  })

  it('reports an item its own pass closed as closed, and fails loudly on an item whose entry is gone', async () => {
    const { world, entries } = await worldWith({ dawn: null, dusk: null })
    const lease = await claim(world, { types: ['syllables'], limit: 1 })
    const [item] = lease?.items ?? []
    await submitFact(world.deps, curatorAgent, {
      kind: 'syllables',
      subject_id: item?.item.entryId as EntryId,
      payload: { syllables: [item?.lemma ?? ''] },
      curation: { reason: 'One syllable.' },
    })
    const done = await completeWork(world.deps, agentA, lease?.lease.id as WorkLeaseId, {
      items: [{ id: item?.item.id as WorkItemId }],
    })
    expect(done.items).toEqual([{ id: item?.item.id, state: 'closed', attempts: 0 }])
    world.entries.splice(0, world.entries.length)
    await expect(claim(world, { types: ['syllables'] })).rejects.toThrow(/Work item entry .* does not exist/)
    expect(entries).toHaveLength(2)
  })

  it('refuses a lease that expired under the write', async () => {
    const { world } = await worldWith({ bank: null })
    const held = await claim(world, { types: ['syllables'] })
    world.deps.work.complete = async () => false
    await expect(completeWork(world.deps, agentA, held?.lease.id as WorkLeaseId, { items: [] })).rejects.toMatchObject({
      code: 'conflict',
    })
  })
})

describe('weak facts as work', () => {
  it('lists a weak fact as an item of its own stage until a correction replaces it [spec: work/weak-facts]', async () => {
    const { world, entries } = await worldWith({ bank: null })
    world.answerLlm(() => ({ model: 'llm-test', verdict: 'uncertain', confidence: 0.5, reason: 'Unsure.' }))
    const { fact } = await submitFact(world.deps, agentA, {
      kind: 'pronunciation',
      subject_id: entries[0] as EntryId,
      payload: { ipa: 'bæŋk', accent: 'us' },
    })
    await settle(world)
    const weak = await claim(world, { types: ['weak_fact'] })
    expect(weak?.items[0]?.item).toMatchObject({
      stage: 5,
      subjectId: fact.id,
      gap: { type: 'weak_fact', fact_id: fact.id, kind: 'pronunciation', reason: 'uncertain' },
    })
    expect(weak?.items[0]?.context.facts.map((candidate) => candidate.id)).toContain(fact.id)
    holdReviews(world)
    await submitFact(world.deps, agentA, {
      kind: 'pronunciation',
      subject_id: entries[0] as EntryId,
      supersedes_id: fact.id,
      payload: { ipa: 'beɪŋk', accent: 'us' },
    })
    expect(itemOf(world, 'weak_fact')).toMatchObject({ awaiting: true })
    world.passReviews()
    await settle(world)
    expect(itemOf(world, 'weak_fact')).toBeUndefined()
  })
})

describe('rescore', () => {
  it('drains stale rows a batch at a time and reports what is left [spec: work/rescore]', async () => {
    const { world, entries } = await worldWith({ by: null, to: null, at: null })
    for (const entry of entries) {
      const row = world.work.get(entry)
      if (!row) throw new Error('No worklist row.')
      Object.assign(row, { revision: row.revision + 1 })
    }
    expect(await rescoreStaleWork(world.deps, 2)).toEqual({ rescored: 2, remaining: 1 })
    expect(await rescoreStaleWork(world.deps, 2)).toEqual({ rescored: 1, remaining: 0 })
    expect(await rescoreStaleWork(world.deps, 2)).toEqual({ rescored: 0, remaining: 0 })
  })

  it('fails loudly when a stale row has no entry, after rescoring the rows behind it', async () => {
    const { world, entries } = await worldWith({ bank: null, cove: null })
    for (const entry of entries) {
      const row = world.work.get(entry)
      Object.assign(row ?? {}, { revision: (row?.revision ?? 0) + 1 })
    }
    world.entries.splice(0, 1)
    await expect(refreshStaleWork(world.deps)).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: expect.stringMatching(/Worklist entry .* does not exist/) })],
    })
    const cove = world.work.get(entries[1] as EntryId)
    expect(cove?.scoredRevision).toBe(cove?.revision)
  })
})
