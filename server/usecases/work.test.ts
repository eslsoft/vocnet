import { admin, agentA, agentB } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import type { WorkLeaseId } from '@shared/work'
import { describe, expect, it } from 'vitest'
import { createEntry, createSense } from './catalog'
import { retractFact } from './facts'
import { reviewFact } from './review'
import { claimWork, completeWork } from './work'

const start = '2026-01-01T00:00:00.000Z'

async function worldWith(lemmas: string[]) {
  const world = fakeWorld()
  const entries = []
  for (const [index, lemma] of lemmas.entries()) {
    world.setNow(`2026-01-01T00:00:0${index}.000Z`)
    entries.push(await createEntry(world.deps, agentA, { lemma }))
  }
  world.setNow(start)
  return { world, entries }
}

const lemmaOf = (claim: Awaited<ReturnType<typeof claimWork>>) => claim?.lease.lemma

describe('claimWork', () => {
  it('serves never-worked entries oldest first, then the least recently worked, skipping dead entries [spec: work/claim-order]', async () => {
    const { world, entries } = await worldWith(['bank', 'shore', 'tide', 'cove'])
    const [, shore, tide] = entries
    await retractFact(world.deps, agentA, shore.fact.id)
    world.answerJev(() => ({ model: 'jev-test', answers: { lexical: 0.05 } }))
    expect(await reviewFact(world.deps, tide.fact.id, 'trace')).toBe('rejected')

    const first = await claimWork(world.deps, agentA)
    expect(lemmaOf(first)).toBe('bank')
    await completeWork(world.deps, agentA, first?.lease.id as WorkLeaseId, {})
    const second = await claimWork(world.deps, agentA)
    expect(lemmaOf(second)).toBe('cove')
    await completeWork(world.deps, agentA, second?.lease.id as WorkLeaseId, {})
    expect(lemmaOf(await claimWork(world.deps, agentA))).toBe('bank')
    expect(lemmaOf(await claimWork(world.deps, agentA))).toBe('cove')
    expect(await claimWork(world.deps, agentA)).toBeNull()
  })

  it('returns the lease, the management view, and the gaps', async () => {
    const { world, entries } = await worldWith(['bank'])
    const { sense } = await createSense(world.deps, agentA, {
      entry_id: entries[0].entry.id,
      pos: 'noun',
      gloss: 'land beside a river',
    })
    const claim = await claimWork(world.deps, agentA, 60)
    expect(claim?.lease).toEqual({
      id: expect.any(String),
      entryId: entries[0].entry.id,
      lemma: 'bank',
      holder: 'agent:agent-a',
      expiresAt: '2026-01-01T00:01:00.000Z',
    })
    expect(claim?.entry.senses.map((s) => s.id)).toEqual([sense.id])
    expect(claim?.entry.facts).toHaveLength(2)
    expect(claim?.gaps.map((gap) => gap.type)).toEqual([
      'forms',
      'pronunciation',
      'relations',
      'examples',
      'translations',
    ])
  })

  it('leases an entry to one holder until the lease expires [spec: work/claim-lease]', async () => {
    const { world } = await worldWith(['bank'])
    const held = await claimWork(world.deps, agentA)
    expect(held?.lease.expiresAt).toBe('2026-01-01T00:15:00.000Z')
    expect(await claimWork(world.deps, agentB)).toBeNull()

    world.setNow('2026-01-01T00:15:00.000Z')
    const taken = await claimWork(world.deps, agentB)
    expect(taken?.lease).toMatchObject({ lemma: 'bank', holder: 'agent:agent-b' })
    expect(taken?.lease.id).not.toBe(held?.lease.id)
    await expect(completeWork(world.deps, agentA, held?.lease.id as WorkLeaseId, {})).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})

describe('completeWork', () => {
  it('lets only the holder complete before expiry, and only once [spec: work/complete]', async () => {
    const { world, entries } = await worldWith(['bank'])
    const claim = await claimWork(world.deps, agentA)
    const id = claim?.lease.id as WorkLeaseId

    await expect(completeWork(world.deps, agentB, id, {})).rejects.toMatchObject({ code: 'conflict' })
    await expect(completeWork(world.deps, admin, id, {})).rejects.toMatchObject({ code: 'conflict' })

    world.setNow('2026-01-01T00:05:00.000Z')
    await expect(completeWork(world.deps, agentA, id, { note: 'Added forms.' })).resolves.toEqual({
      entryId: entries[0].entry.id,
      lastWorkedAt: '2026-01-01T00:05:00.000Z',
    })
    expect(world.worked.get(entries[0].entry.id)).toEqual({
      lastWorkedAt: '2026-01-01T00:05:00.000Z',
      lastWorkedBy: 'agent:agent-a',
      lastNote: 'Added forms.',
    })
    await expect(completeWork(world.deps, agentA, id, {})).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses an expired lease and a lease that changed under the write', async () => {
    const { world } = await worldWith(['bank'])
    const claim = await claimWork(world.deps, agentA)
    const id = claim?.lease.id as WorkLeaseId
    world.setNow('2026-01-01T00:15:00.000Z')
    await expect(completeWork(world.deps, agentA, id, {})).rejects.toMatchObject({ code: 'conflict' })

    world.setNow(start)
    world.deps.work.complete = async () => false
    await expect(completeWork(world.deps, agentA, id, {})).rejects.toMatchObject({ code: 'conflict' })
    expect(world.worked.size).toBe(0)
  })
})
