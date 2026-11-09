import { MAX_REVISIT_STREAK } from '@server/domain/work'
import { admin, agentA, agentB } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import type { EntryId, SenseId } from '@shared/facts'
import type { WorkLeaseId } from '@shared/work'
import { describe, expect, it } from 'vitest'
import { createEntry, createSense } from './catalog'
import { retractFact, submitFact } from './facts'
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
  it('serves second passes first, then never-claimed entries, then the rest, skipping dead entries [spec: work/claim-order]', async () => {
    const { world, entries } = await worldWith(['bank', 'shore', 'tide', 'cove', 'reef'])
    const [, shore, tide] = entries
    await retractFact(world.deps, agentA, shore.fact.id)
    world.failReviews()
    expect(await reviewFact(world.deps, tide.fact.id, 'trace')).toBe('rejected')
    const claimAt = async (minute: number) => {
      world.setNow(`2026-01-01T00:${String(minute).padStart(2, '0')}:00.000Z`)
      return claimWork(world.deps, agentA)
    }
    const workAt = async (minute: number) => {
      const claim = await claimAt(minute)
      await completeWork(world.deps, agentA, claim?.lease.id as WorkLeaseId, {})
      return lemmaOf(claim)
    }

    const bank = await claimAt(1)
    const cove = await claimAt(2)
    expect([lemmaOf(bank), lemmaOf(cove)]).toEqual(['bank', 'cove'])
    await completeWork(world.deps, agentA, cove?.lease.id as WorkLeaseId, {})
    await completeWork(world.deps, agentA, bank?.lease.id as WorkLeaseId, {})

    const order = []
    for (const minute of [3, 4, 5, 6, 7, 8]) order.push(await workAt(minute))
    expect(order).toEqual(['bank', 'cove', 'reef', 'reef', 'bank', 'cove'])
    expect(lemmaOf(await claimAt(9))).toBe('reef')
    expect(lemmaOf(await claimAt(9))).toBe('bank')
    expect(lemmaOf(await claimAt(9))).toBe('cove')
    expect(await claimAt(9)).toBeNull()
  })

  it('serves never-claimed seed entries before other never-claimed entries, each after its second pass [spec: work/claim-order]', async () => {
    const { world } = await worldWith(['bank', 'cove', 'reef', 'tide'])
    for (const lemma of ['reef', 'tide']) await createEntry(world.deps, agentA, { lemma, seed: true })

    const order = []
    for (let minute = 1; minute <= 9; minute++) {
      world.setNow(`2026-01-01T00:0${minute}:00.000Z`)
      const claim = await claimWork(world.deps, agentA)
      await completeWork(world.deps, agentA, claim?.lease.id as WorkLeaseId, {})
      order.push(lemmaOf(claim))
    }
    expect(order).toEqual(['reef', 'reef', 'tide', 'tide', 'bank', 'bank', 'cove', 'cove', 'reef'])
  })

  it('revisits entries a pass added to and left open, seeds first, before the rotation [spec: work/claim-order]', async () => {
    const { world } = await worldWith(['bank', 'cove', 'reef', 'tide', 'wave'])
    for (const lemma of ['cove', 'reef']) await createEntry(world.deps, agentA, { lemma, seed: true })
    const glosses: Record<string, string> = { cove: 'A small sheltered bay.', bank: 'Land beside a river.' }

    const order = []
    for (let minute = 10; minute < 24; minute++) {
      world.setNow(`2026-01-01T00:${minute}:00.000Z`)
      const claim = await claimWork(world.deps, agentA)
      const lemma = lemmaOf(claim) as string
      // Each entry gets a sense on its second pass only, so that pass leaves per-sense gaps open.
      if (glosses[lemma] && order.filter((seen) => seen === lemma).length === 1) {
        await createSense(world.deps, agentA, {
          entry_id: claim?.lease.entryId as EntryId,
          pos: 'noun',
          gloss: glosses[lemma],
        })
      }
      await completeWork(world.deps, agentA, claim?.lease.id as WorkLeaseId, {})
      order.push(lemma)
    }
    expect(order).toEqual([
      ...['cove', 'cove', 'reef', 'reef', 'cove'],
      ...['bank', 'bank', 'tide', 'tide', 'wave', 'wave', 'bank'],
      ...['reef', 'cove'],
    ])
  })

  describe('bounds revisits whatever passes and reviews do [spec: work/revisit-bound]', () => {
    type Pass = (world: ReturnType<typeof fakeWorld>, entryId: EntryId, pass: number) => Promise<unknown>
    /** A seed entry whose every pass runs `during`, next to a never-claimed entry outside the seed list. */
    async function claimsWith(during: Pass) {
      const { world, entries } = await worldWith(['cove'])
      await createSense(world.deps, agentB, {
        entry_id: entries[0].entry.id,
        pos: 'noun',
        gloss: 'A small sheltered bay.',
      })
      world.setNow('2026-01-01T00:00:05.000Z')
      await createEntry(world.deps, agentA, { lemma: 'the', seed: true })
      const order = []
      for (let minute = 10; minute < 18; minute++) {
        world.setNow(`2026-01-01T00:${minute}:00.000Z`)
        const claim = await claimWork(world.deps, agentA)
        const entryId = claim?.lease.entryId as EntryId
        const pass = order.filter((seen) => seen === 'the').length
        if (claim?.lease.lemma === 'the') {
          // The first pass gives the entry its sense; the loop runs from the second.
          if (pass === 0) await createSense(world.deps, agentA, { entry_id: entryId, pos: 'noun', gloss: 'The one.' })
          else await during(world, entryId, pass)
        }
        await completeWork(world.deps, agentA, claim?.lease.id as WorkLeaseId, {})
        order.push(lemmaOf(claim))
      }
      return order
    }
    const senseOf = (world: ReturnType<typeof fakeWorld>, entryId: EntryId) =>
      world.senses.find((sense) => sense.entryId === entryId)?.id as SenseId

    it('drops an entry whose passes only add facts no gap needs', async () => {
      const order = await claimsWith((world, entryId, pass) =>
        submitFact(world.deps, agentA, {
          kind: 'example',
          subject_id: senseOf(world, entryId),
          payload: { text: `The example number ${pass}.` },
        }),
      )
      // The second pass closes the examples gap; the third adds a second example and earns nothing.
      expect(order.slice(0, 4)).toEqual(['the', 'the', 'the', 'cove'])
    })

    it('drops an entry whose relation review rejects every time, after the streak', async () => {
      let bay: SenseId | undefined
      const order = await claimsWith(async (world, entryId) => {
        bay ??= world.senses.find((sense) => sense.entryId !== entryId)?.id
        const { fact } = await submitFact(world.deps, agentA, {
          kind: 'relation',
          subject_id: senseOf(world, entryId),
          payload: { type: 'hypernym', target_sense_id: bay as SenseId },
        })
        world.failReviews()
        expect(await reviewFact(world.deps, fact.id, 'trace')).toBe('rejected')
      })
      expect(order.slice(0, 3 + MAX_REVISIT_STREAK)).toEqual([...Array(2 + MAX_REVISIT_STREAK).fill('the'), 'cove'])
    })

    it('drops an entry another agent keeps giving senses during its passes, after the streak', async () => {
      const order = await claimsWith((world, entryId, pass) =>
        createSense(world.deps, agentB, { entry_id: entryId, pos: 'noun', gloss: `Meaning number ${pass}.` }),
      )
      expect(order.slice(0, 3 + MAX_REVISIT_STREAK)).toEqual([...Array(2 + MAX_REVISIT_STREAK).fill('the'), 'cove'])
    })
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
      claimedAt: start,
      revisitStreak: 0,
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

  it('fails loudly when the leased entry is gone', async () => {
    const { world } = await worldWith(['bank'])
    const claim = await claimWork(world.deps, agentA)
    world.entries.splice(0)
    await expect(completeWork(world.deps, agentA, claim?.lease.id as WorkLeaseId, {})).rejects.toThrow(
      /Leased entry .* does not exist/,
    )
  })
})
