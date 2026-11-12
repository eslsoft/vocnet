import { admin, agentA, agentB, curatorAgent } from '@server/testing/actors'
import { type FakeWorld, fakeWorld } from '@server/testing/fakes'
import { drainReviews, headword } from '@server/testing/seed'
import type { EntryId, SenseId } from '@shared/facts'
import type { CefrLevel } from '@shared/reference'
import type { ClaimWorkInput, WorkItemId, WorkLeaseId, WorkType } from '@shared/work'
import { describe, expect, it } from 'vitest'
import { createEntry } from './catalog'
import { submitFact } from './facts'
import { claimWork, completeWork, EXPIRED_LEASE_RETENTION_MS, purgeExpiredLeases } from './work'
import { refreshStaleWork, rescoreStaleWork } from './work-scores'

const start = '2026-01-01T00:00:00.000Z'

const reference = (zipf: number, level: CefrLevel) => ({
  frequency: { zipf, rank: 1, source_id: 'wordfreq' },
  cefr: [{ pos: 'noun' as const, level, source_id: 'cefrj' }],
})

const claim = (world: FakeWorld, input: Partial<ClaimWorkInput> = {}, actor = agentA) =>
  claimWork(world.deps, actor, { limit: 10, ...input })

const itemOf = (world: FakeWorld, type: WorkType, subjectId?: string) =>
  world.items.find((item) => item.type === type && (!subjectId || item.subjectId === subjectId))

/** A headword "cat" with one published common noun sense. */
async function cat(world = fakeWorld()) {
  const { entry, senses } = await headword(world, 'cat', [{ pos: 'noun', gloss: 'a small furry animal kept as a pet' }])
  return { world, entry, sense: senses[0] as SenseId }
}

const complete = (
  world: FakeWorld,
  leaseId: WorkLeaseId,
  items: Array<{ id: WorkItemId; note?: string; found_none?: boolean; blocked_on?: string[] }>,
  actor = agentA,
) => completeWork(world.deps, actor, leaseId, { items })

describe('claimWork', () => {
  it('leases the items of the highest-priority type only, within the types asked, in learner order [spec: work/claim-one-type]', async () => {
    const world = fakeWorld()
    world.references.set('eagle', reference(4, 'B1'))
    world.references.set('dog', reference(5, 'A1'))
    world.references.set('owl', reference(3, 'C2'))
    for (const lemma of ['eagle', 'dog', 'owl']) await headword(world, lemma)
    await headword(world, 'cat', [{ pos: 'noun', gloss: 'a small furry animal kept as a pet' }])

    const first = await claim(world, { limit: 2 })
    expect(first?.lease).toMatchObject({ type: 'senses', holder: 'agent:agent-a' })
    expect(first?.items.map(({ lemma }) => lemma)).toEqual(['dog', 'eagle'])
    expect(first?.items[0]?.context.view?.entry.lemma).toBe('dog')

    // Nobody else gets the leased items; the next senses item is the C2 owl's.
    const second = await claim(world, { types: ['senses'] }, agentB)
    expect(second?.items.map(({ lemma }) => lemma)).toEqual(['owl'])

    const sounds = await claim(world, { types: ['pronunciation'] }, agentB)
    expect(sounds?.lease.type).toBe('pronunciation')
    expect(sounds?.items.map(({ lemma }) => lemma)).toEqual(['cat'])
    expect(sounds?.items[0]?.context).toMatchObject({ sense: null, view: null, entry: { lemma: 'cat' } })

    expect(await claim(world, { types: ['form_pronunciations'] })).toBeNull()
  })

  it('carries the sense, its facts, and the criteria of a sense item [spec: work/claim-context]', async () => {
    const { world, sense } = await cat()
    const claimed = await claim(world, { types: ['examples'] })
    const [item] = claimed?.items ?? []
    expect(item?.item).toMatchObject({ type: 'examples', subjectId: sense, claimedGap: { type: 'examples', need: 1 } })
    expect(item?.context.sense).toMatchObject({ id: sense, pos: 'noun', gloss: 'a small furry animal kept as a pet' })
    expect(item?.context.criteria.fills.map((fill) => fill.kind)).toContain('example')
    expect(claimed?.lease.entryIds).toEqual([item?.item.entryId])
  })

  it("serves no item a pending fact may change, while the entry's other items stay workable [spec: work/item-awaiting]", async () => {
    const { world, sense } = await cat()
    await submitFact(world.deps, agentB, { kind: 'example', subject_id: sense, payload: { text: 'The cat slept.' } })
    expect(itemOf(world, 'examples')?.awaiting).toBe(true)
    expect(await claim(world, { types: ['examples'] })).toBeNull()
    expect((await claim(world, { types: ['grammar'] }))?.items).toHaveLength(1)
  })

  it('fails loudly when a leased item belongs to an entry that is gone', async () => {
    const { world } = await cat()
    world.entries.splice(0)
    await expect(claim(world, { types: ['examples'] })).rejects.toThrow('does not exist')
  })
})

describe('completeWork', () => {
  it('counts an attempt for a pass that leaves the gap as claimed, and turns the item into a ticket after two [spec: work/item-attempts-usecase] [spec: work/stuck-ticket]', async () => {
    const { world, sense } = await cat()
    const first = await claim(world, { types: ['examples'] })
    const id = first?.items[0]?.item.id as WorkItemId
    await expect(complete(world, first?.lease.id as WorkLeaseId, [{ id, note: 'nothing yet' }])).resolves.toEqual({
      leaseId: first?.lease.id,
      items: [{ id, state: 'open', attempts: 1 }],
    })
    const second = await claim(world, { types: ['examples'] })
    expect(second?.items[0]?.item.id).toBe(id)
    const done = await complete(world, second?.lease.id as WorkLeaseId, [{ id, note: 'still nothing' }])
    expect(done.items).toEqual([{ id, state: 'ticket', attempts: 2 }])
    expect(world.tickets).toMatchObject([
      { type: 'stuck_work', targetType: 'sense', target: sense, message: 'examples: still nothing', status: 'open' },
    ])
    expect(world.attempts.map((attempt) => attempt.outcome)).toEqual(['no_progress', 'stuck'])
    expect(await claim(world, { types: ['examples'] })).toBeNull()
  })

  it('judges a worked item once its facts are reviewed: a rejection counts the attempt, a pass moves it on [spec: work/item-review-verdict]', async () => {
    const { world, entry } = await cat()
    const pronounce = async (ipa: string) => {
      const claimed = await claim(world, { types: ['pronunciation'] })
      const id = claimed?.items[0]?.item.id as WorkItemId
      await submitFact(world.deps, agentA, {
        kind: 'pronunciation',
        subject_id: entry.id,
        payload: { ipa, accent: 'us' },
      })
      return complete(world, claimed?.lease.id as WorkLeaseId, [{ id }])
    }

    world.failReviews()
    expect((await pronounce('kæt')).items[0]).toMatchObject({ state: 'awaiting_review', attempts: 0 })
    await drainReviews(world)
    expect(itemOf(world, 'pronunciation')).toMatchObject({ attempts: 1, awaiting: false })

    world.passReviews()
    expect((await pronounce('kæːt')).items[0]).toMatchObject({ state: 'awaiting_review', attempts: 1 })
    await drainReviews(world)
    expect(itemOf(world, 'pronunciation')).toMatchObject({ attempts: 0, gap: { accents: ['uk'] } })
    expect(world.attempts.map((attempt) => attempt.outcome)).toEqual(['no_progress', 'progressed'])
  })

  it('lets only the holder complete its own items before expiry, once, and releases the rest without an attempt [spec: work/complete]', async () => {
    const world = fakeWorld()
    await headword(world, 'dog')
    await headword(world, 'owl')
    const claimed = await claim(world, { types: ['senses'] })
    const leaseId = claimed?.lease.id as WorkLeaseId
    const [dog, owl] = claimed?.items.map(({ item }) => item.id) as [WorkItemId, WorkItemId]

    await expect(complete(world, leaseId, [{ id: dog }], agentB)).rejects.toMatchObject({ code: 'conflict' })
    await expect(
      complete(world, leaseId, [{ id: '00000000-0000-4000-9000-0000000000ff' as WorkItemId }]),
    ).rejects.toMatchObject({ code: 'invalid_reference' })
    await expect(complete(world, leaseId, [{ id: dog, note: 'tried' }])).resolves.toMatchObject({
      items: [{ id: dog, state: 'open', attempts: 1 }],
    })
    expect(world.items.find((item) => item.id === owl)).toMatchObject({ attempts: 0, worked: false, lease: null })
    await expect(complete(world, leaseId, [{ id: dog }])).rejects.toMatchObject({ code: 'not_found' })
  })

  it('leases an item to one holder until the lease expires, then refuses the late complete [spec: work/claim-lease]', async () => {
    const world = fakeWorld()
    await headword(world, 'dog')
    const held = await claim(world, { types: ['senses'], lease_seconds: 60 })
    expect(await claim(world, { types: ['senses'] }, agentB)).toBeNull()
    world.setNow('2026-01-01T00:01:00.000Z')
    const taken = await claim(world, { types: ['senses'] }, agentB)
    expect(taken?.items[0]?.item.id).toBe(held?.items[0]?.item.id)
    await expect(
      complete(world, held?.lease.id as WorkLeaseId, [{ id: held?.items[0]?.item.id as WorkItemId }]),
    ).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('expired') })
  })

  it('reports an item its own pass closed as closed', async () => {
    const { world, sense } = await cat()
    const claimed = await claim(world, { types: ['examples'] })
    const id = claimed?.items[0]?.item.id as WorkItemId
    await submitFact(world.deps, agentA, { kind: 'example', subject_id: sense, payload: { text: 'The cat slept.' } })
    await drainReviews(world)
    expect(itemOf(world, 'examples')).toBeUndefined()
    await expect(complete(world, claimed?.lease.id as WorkLeaseId, [{ id }])).resolves.toMatchObject({
      items: [{ id, state: 'closed', attempts: 0 }],
    })
    expect(world.attempts).toMatchObject([{ itemId: id, outcome: 'closed' }])
  })

  it('refuses a lease that expired under the write', async () => {
    const world = fakeWorld()
    await headword(world, 'dog')
    const claimed = await claim(world, { types: ['senses'] })
    world.deps.work.complete = async () => false
    await expect(
      complete(world, claimed?.lease.id as WorkLeaseId, [{ id: claimed?.items[0]?.item.id as WorkItemId }]),
    ).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('claim again') })
  })

  it('completes an optional slot whose pass found none, recording the pass and its note [spec: work/found-none]', async () => {
    const { world, entry, sense } = await cat()
    const claimed = await claim(world, { types: ['synonyms'] })
    const id = claimed?.items[0]?.item.id as WorkItemId
    const done = await complete(world, claimed?.lease.id as WorkLeaseId, [
      { id, note: 'Considered kitty; it is a pet name, not a synonym.', found_none: true },
    ])
    expect(done.items).toEqual([{ id, state: 'closed', attempts: 0 }])
    expect(world.passes).toMatchObject([
      {
        entryId: entry.id,
        type: 'synonyms',
        subjectId: sense,
        note: 'Considered kitty; it is a pet name, not a synonym.',
        holder: 'agent:agent-a',
      },
    ])
    expect(world.attempts).toMatchObject([{ itemId: id, outcome: 'passed' }])
    expect(world.work.get(entry.id)?.credibility).toBeLessThan(1)
  })

  it('refuses found_none and blocked_on on a required slot [spec: work/required-slot]', async () => {
    const { world } = await cat()
    const claimed = await claim(world, { types: ['examples'] })
    const leaseId = claimed?.lease.id as WorkLeaseId
    const id = claimed?.items[0]?.item.id as WorkItemId
    await expect(complete(world, leaseId, [{ id, found_none: true }])).rejects.toMatchObject({
      code: 'invalid_request',
    })
    await expect(complete(world, leaseId, [{ id, blocked_on: ['kitten'] }])).rejects.toMatchObject({
      code: 'invalid_request',
    })
    expect(world.leases).toHaveLength(1)
  })

  it('reopens a slot whose pass was blocked on a word once that word is admitted [spec: work/blocked-reopen]', async () => {
    const { world, sense } = await cat()
    const claimed = await claim(world, { types: ['synonyms'] })
    const id = claimed?.items[0]?.item.id as WorkItemId
    await complete(world, claimed?.lease.id as WorkLeaseId, [
      { id, note: 'moggy fits but is no entry yet', found_none: true, blocked_on: ['moggy'] },
    ])
    expect(itemOf(world, 'synonyms', sense)).toBeUndefined()
    expect(world.blocks).toEqual([{ lemma: 'moggy', type: 'synonyms', subjectId: sense }])

    await createEntry(world.deps, admin, { lemma: 'kitten', batch: 2 })
    expect(itemOf(world, 'synonyms', sense)).toBeUndefined()
    await createEntry(world.deps, curatorAgent, { lemma: 'moggy', batch: 2 })
    expect(world.passes).toEqual([])
    // The admission rescores the reopened entry, so its item is back in the same request.
    expect(await world.deps.work.countStale()).toBe(0)
    expect(itemOf(world, 'synonyms', sense)).toMatchObject({ attempts: 0, worked: false })
  })
})

describe('purgeExpiredLeases', () => {
  it('deletes only the leases that expired more than a day ago', async () => {
    const world = fakeWorld()
    await headword(world, 'dog')
    await headword(world, 'owl')
    await claim(world, { types: ['senses'], limit: 1, lease_seconds: 60 })
    world.setNow('2026-01-01T12:00:00.000Z')
    await claim(world, { types: ['senses'], limit: 1, lease_seconds: 60 }, agentB)
    world.setNow(new Date(Date.parse(start) + 60_000 + EXPIRED_LEASE_RETENTION_MS).toISOString())
    expect(await purgeExpiredLeases(world.deps)).toBe(1)
    expect(world.leases.map((lease) => lease.holder)).toEqual(['agent:agent-b'])
  })
})

describe('rescore', () => {
  const stale = (world: FakeWorld, entryId: EntryId) => {
    const row = world.work.get(entryId)
    if (row) row.revision += 1
  }

  it('drains stale rows a batch at a time and reports what is left [spec: work/rescore]', async () => {
    const world = fakeWorld()
    const entries = [await headword(world, 'dog'), await headword(world, 'owl'), await headword(world, 'eagle')]
    // An entry no batch admitted has no work, and rescores all the same.
    const unlisted = await world.deps.nodes.insertEntry({
      id: '00000000-0000-4000-8000-0000000000ee' as EntryId,
      lemma: 'white rice' as never,
      createdBy: 'admin:admin-1' as never,
      createdAt: start,
    })
    for (const entry of [...entries.map((seeded) => seeded.entry), unlisted]) stale(world, entry.id)
    expect(await rescoreStaleWork(world.deps, 2)).toEqual({ rescored: 2, remaining: 2 })
    expect(await refreshStaleWork(world.deps)).toBe(2)
    expect(world.items.some((item) => item.entryId === unlisted.id)).toBe(false)
    expect(await rescoreStaleWork(world.deps, 2)).toEqual({ rescored: 0, remaining: 0 })
  })

  it('fails loudly when a stale row has no entry, after rescoring the rows behind it', async () => {
    const world = fakeWorld()
    const { entry } = await headword(world, 'dog')
    stale(world, entry.id)
    world.work.set('00000000-0000-4000-8000-000000000000' as EntryId, {
      ...(world.work.get(entry.id) as NonNullable<ReturnType<typeof world.work.get>>),
    })
    const failure = await rescoreStaleWork(world.deps, 10).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toHaveLength(1)
    expect(await world.deps.work.countStale()).toBe(1)
  })
})
