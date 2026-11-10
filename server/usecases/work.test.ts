import { admin, agentA, agentB } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import type { EntryId, FactId, SenseId } from '@shared/facts'
import type { WorkLeaseId } from '@shared/work'
import { describe, expect, it } from 'vitest'
import { createEntry, createSense } from './catalog'
import { retractFact, submitFact } from './facts'
import { claimFeedback, resolveFeedback, submitFeedback } from './feedback'
import { reviewFact } from './review'
import { claimWork, completeWork } from './work'
import { refreshStaleWork } from './work-scores'

const start = '2026-01-01T00:00:00.000Z'

async function worldWith(lemmas: string[]) {
  const world = fakeWorld()
  const entries = []
  for (const [index, lemma] of lemmas.entries()) {
    world.setNow(`2026-01-01T00:00:0${index}.000Z`)
    entries.push(await createEntry(world.deps, agentA, { lemma }))
  }
  world.setNow(start)
  await settle(world)
  return { world, entries }
}

type World = ReturnType<typeof fakeWorld>
/** Lets every pending review land with the reviewers' current answers. */
async function settle(world: World) {
  for (const fact of world.facts.filter((candidate) => candidate.status === 'pending')) {
    await reviewFact(world.deps, fact.id, 'trace')
  }
}
/** Claims and completes the next entry, running `during` while the lease is held. */
async function pass(world: World, during?: (entryId: EntryId, lemma: string) => Promise<unknown>) {
  const claim = await claimWork(world.deps, agentA)
  if (!claim) return null
  await during?.(claim.lease.entryId, claim.lease.lemma)
  await completeWork(world.deps, agentA, claim.lease.id, {})
  return claim.lease.lemma
}

/** Gives the entry a preposition sense, which needs no relations, its sense list, and every other slot. */
async function fill(world: World, entryId: EntryId, author = agentA) {
  const { sense } = await createSense(world.deps, author, { entry_id: entryId, pos: 'preposition', gloss: 'Near to.' })
  const entry = await world.deps.nodes.findEntry(entryId)
  const facts = [
    { kind: 'morphology', subject_id: entryId, payload: { parts: [{ form: entry?.lemma, role: 'base' }] } },
    { kind: 'form', subject_id: entryId, payload: { form: 'bys', type: 'plural' } },
    { kind: 'pronunciation', subject_id: entryId, payload: { ipa: 'baɪ', accent: 'us' } },
    { kind: 'example', subject_id: sense.id, payload: { text: 'Sit by me.' } },
    { kind: 'translation', subject_id: sense.id, payload: { language: 'zh', text: '在旁边' } },
    { kind: 'sense_list', subject_id: entryId, payload: { common: [sense.id], extra: [] } },
  ] as const
  for (const input of facts) await submitFact(world.deps, author, input as never)
  return sense.id
}

const drain = async (world: World) => {
  const order = []
  for (let step = 0; step < 20; step++) {
    const lemma = await pass(world)
    if (lemma === null) return order
    order.push(lemma)
  }
  throw new Error('The worklist did not empty.')
}

describe('claimWork', () => {
  it('serves A1 to C2, then frequency without a level, then the rest; never-claimed by frequency, claimed by least recently claimed, never a dead one [spec: work/claim-order]', async () => {
    const reference = (zipf: number | null, level?: 'A1' | 'B2') => ({
      frequency: zipf === null ? null : { zipf, rank: 1, source_id: 'wordfreq' },
      cefr: level ? [{ pos: 'noun' as const, level, source_id: 'cefrj' }] : [],
    })
    const { world } = await worldWith(['reef', 'wave', 'tide', 'cove', 'bank', 'sand'])
    world.references.set('bank', reference(5, 'A1'))
    world.references.set('cove', reference(3, 'A1'))
    world.references.set('sand', reference(6, 'A1'))
    world.references.set('tide', reference(4, 'B2'))
    world.references.set('wave', reference(4.5))
    const sand = world.facts.find((fact) => fact.kind === 'entry' && fact.subjectId === world.entries[5].id)
    await retractFact(world.deps, agentA, sand?.id as FactId)
    const order: Array<string | null> = []
    for (let minute = 10; minute < 21; minute++) {
      world.setNow(`2026-01-01T00:${minute}:00.000Z`)
      // Each entry's first pass gives it a sense, which leaves gaps; its second adds nothing and stalls it.
      const seen = [...order]
      order.push(
        await pass(world, async (entryId, lemma) => {
          if (!seen.includes(lemma))
            await createSense(world.deps, agentA, { entry_id: entryId, pos: 'noun', gloss: `A ${lemma}.` })
        }),
      )
      await settle(world)
    }
    expect(order).toEqual(['bank', 'cove', 'bank', 'cove', 'tide', 'tide', 'wave', 'wave', 'reef', 'reef', null])
  })

  it('hands out nothing once every entry is complete and good [spec: work/claim-empty]', async () => {
    const { world, entries } = await worldWith(['by', 'of'])
    expect(await pass(world, (entryId) => fill(world, entryId))).toBe('by')
    await fill(world, entries[1].entry.id, agentB)
    expect(await claimWork(world.deps, agentA)).toBeNull()
    expect(world.work.get(entries[0].entry.id)).toMatchObject({ completeness: 1, quality: 1, stalled: false })
  })

  describe('stalls an entry whose pass made no lasting progress until its open work changes [spec: work/stall-loop]', () => {
    async function cove() {
      const { world, entries } = await worldWith(['bay', 'cove'])
      const bay = await createSense(world.deps, agentB, { entry_id: entries[0].entry.id, pos: 'noun', gloss: 'A bay.' })
      const nook = await createSense(world.deps, agentB, {
        entry_id: entries[1].entry.id,
        pos: 'noun',
        gloss: 'A small bay.',
      })
      await submitFact(world.deps, agentB, { kind: 'example', subject_id: nook.sense.id, payload: { text: 'A cove.' } })
      world.references.set('cove', { frequency: { zipf: 3, rank: 1, source_id: 'wordfreq' }, cefr: [] })
      await settle(world)
      return { world, bay: bay.sense.id, nook: nook.sense.id }
    }

    it('stalls when review rejects what the pass added, and after a pass that only added what no gap needed', async () => {
      const { world, bay, nook } = await cove()
      const rejected = await pass(world, async () => {
        const { fact } = await submitFact(world.deps, agentA, {
          kind: 'relation',
          subject_id: nook,
          payload: { type: 'hypernym', target_sense_id: bay },
        })
        world.failReviews()
        expect(await reviewFact(world.deps, fact.id, 'trace')).toBe('rejected')
      })
      expect(rejected).toBe('cove')
      expect(await pass(world)).toBe('bay')
      expect(await claimWork(world.deps, agentA)).toBeNull()

      // Another principal's translation changes cove's open work; a pass adding a second example does not.
      world.passReviews()
      await submitFact(world.deps, agentB, {
        kind: 'translation',
        subject_id: nook,
        payload: { language: 'zh', text: '小海湾' },
      })
      await settle(world)
      const extra = () =>
        submitFact(world.deps, agentA, { kind: 'example', subject_id: nook, payload: { text: 'Another cove.' } })
      expect(await pass(world, extra)).toBe('cove')
      await settle(world)
      expect(await claimWork(world.deps, agentA)).toBeNull()
    })

    it('keeps the entry out of claims while its facts await review, so a rejection after the lease stalls it [spec: work/awaiting-review]', async () => {
      const { world, bay, nook } = await cove()
      const claims: string[] = []
      const relations: FactId[] = []
      for (let minute = 1; minute <= 6; minute++) {
        world.setNow(`2026-01-01T00:0${minute}:00.000Z`)
        const lemma = await pass(world, async (_entryId, claimed) => {
          if (claimed !== 'cove' || relations.length > 0) return
          const { fact } = await submitFact(world.deps, agentA, {
            kind: 'relation',
            subject_id: nook,
            payload: { type: 'hypernym', target_sense_id: bay },
          })
          relations.push(fact.id)
        })
        if (lemma) claims.push(lemma)
      }
      // The pass ended with its relation pending, so cove and bay, the relation's target, both wait.
      expect(claims).toEqual(['cove'])
      world.failReviews()
      expect(await reviewFact(world.deps, relations[0], 'trace')).toBe('rejected')
      expect(await drain(world)).toEqual(['bay'])
      expect(world.work.get(world.senses.find((sense) => sense.id === nook)?.entryId as EntryId)).toMatchObject({
        stalled: true,
        awaitingReview: false,
      })
    })

    it('lifts the stall when a fact about the entry leaves live', async () => {
      const { world, nook } = await cove()
      expect(await drain(world)).toEqual(['cove', 'bay'])
      const example = world.facts.find((fact) => fact.kind === 'example' && fact.subjectId === nook)
      await retractFact(world.deps, agentB, example?.id as FactId)
      expect(await drain(world)).toEqual(['cove'])
    })
  })

  it('names weak facts, and stops serving the entry once a correction replaces them [spec: work/weak-facts]', async () => {
    const { world, entries } = await worldWith(['by'])
    const sense = await fill(world, entries[0].entry.id)
    const example = world.facts.find((fact) => fact.kind === 'example') as { id: FactId }
    for (const fact of world.facts.filter((candidate) => candidate.id !== example.id)) {
      await reviewFact(world.deps, fact.id, 'trace')
    }
    world.answerJev((questions) => ({
      model: 'jev-test',
      answers: Object.fromEntries(Object.keys(questions).map((key) => [key, 0.6])),
    }))
    world.answerLlm(() => ({ model: 'llm-test', verdict: 'uncertain', confidence: 0.5, reason: 'Unsure.' }))
    expect(await reviewFact(world.deps, example.id, 'trace')).toBe('published')

    const claim = await claimWork(world.deps, agentA)
    expect(claim?.gaps).toEqual([])
    expect(claim?.weakFacts).toEqual([{ id: example.id, kind: 'example', reason: 'uncertain' }])
    expect(claim?.entry).toMatchObject({ completeness: 1, quality: 1 - 1 / 8 })
    const { fact: correction } = await submitFact(world.deps, agentA, {
      kind: 'example',
      subject_id: sense as SenseId,
      payload: { text: 'Sit by the fire.' },
      supersedes_id: example.id,
    })
    await completeWork(world.deps, agentA, claim?.lease.id as WorkLeaseId, {})
    // The correction awaits review, and the weak example holds its slot until it publishes.
    expect(await claimWork(world.deps, agentA)).toBeNull()
    world.answerLlm(() => ({ model: 'llm-test', verdict: 'pass', confidence: 0.9, reason: 'Right.' }))
    expect(await reviewFact(world.deps, correction.id, 'trace')).toBe('published')
    expect(world.work.get(entries[0].entry.id)).toMatchObject({ completeness: 1, quality: 1 })
    expect(await claimWork(world.deps, agentA)).toBeNull()
  })

  it('counts a fact under open feedback as weak until the feedback closes', async () => {
    const { world, entries } = await worldWith(['by'])
    await fill(world, entries[0].entry.id)
    for (const fact of world.facts.filter((candidate) => candidate.status === 'pending')) {
      await reviewFact(world.deps, fact.id, 'trace')
    }
    expect(await claimWork(world.deps, agentA)).toBeNull()
    const form = world.facts.find((fact) => fact.kind === 'form') as { id: FactId }
    const item = await submitFeedback(world.deps, 'client', {
      target_type: 'fact',
      target_id: form.id,
      message: 'Not a word.',
    })
    const claim = await claimWork(world.deps, agentA)
    expect(claim?.weakFacts).toEqual([{ id: form.id, kind: 'form', reason: 'feedback' }])
    await completeWork(world.deps, agentA, claim?.lease.id as WorkLeaseId, {})
    await claimFeedback(world.deps, agentB, item.id)
    const claimed = world.work.get(entries[0].entry.id)
    expect(claimed).toMatchObject({ quality: 1 - 1 / 8, scoredRevision: claimed?.revision })
    await resolveFeedback(world.deps, agentB, item.id, { resolution: 'dismissed', note: 'It is.' })
    expect(world.work.get(entries[0].entry.id)).toMatchObject({ quality: 1 })
  })

  it('rescores rows a lost rescore left stale, which stay claimable meanwhile', async () => {
    const { world, entries } = await worldWith(['by'])
    await fill(world, entries[0].entry.id)
    const row = world.work.get(entries[0].entry.id)
    if (!row) throw new Error('No worklist row.')
    Object.assign(row, { revision: row.revision + 1 })
    expect(await refreshStaleWork(world.deps)).toBe(1)
    expect(await refreshStaleWork(world.deps)).toBe(0)
    expect(await claimWork(world.deps, agentA)).toBeNull()
  })

  it('returns the lease, the management view, and the gaps', async () => {
    const { world, entries } = await worldWith(['bank'])
    const { sense } = await createSense(world.deps, agentA, {
      entry_id: entries[0].entry.id,
      pos: 'noun',
      gloss: 'land beside a river',
    })
    await settle(world)
    const claim = await claimWork(world.deps, agentA, 60)
    expect(claim?.lease).toEqual({
      id: expect.any(String),
      entryId: entries[0].entry.id,
      lemma: 'bank',
      holder: 'agent:agent-a',
      claimedAt: start,
      expiresAt: '2026-01-01T00:01:00.000Z',
    })
    expect(claim?.entry.senses.map((s) => s.id)).toEqual([sense.id])
    expect(claim?.entry.facts).toHaveLength(2)
    expect(claim?.weakFacts).toEqual([])
    expect(claim?.gaps.map((gap) => gap.type)).toEqual([
      'sense_list',
      'forms',
      'pronunciation',
      'morphology',
      'relations',
      'examples',
      'translations',
      'topics',
      'grammar',
      'collocations',
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

  it('fails loudly when a stale row has no entry, after rescoring the rows behind it', async () => {
    const { world, entries } = await worldWith(['bank', 'cove'])
    for (const { entry } of entries) {
      const row = world.work.get(entry.id)
      Object.assign(row ?? {}, { revision: (row?.revision ?? 0) + 1 })
    }
    world.entries.splice(0, 1)
    await expect(refreshStaleWork(world.deps)).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: expect.stringMatching(/Worklist entry .* does not exist/) })],
    })
    const cove = world.work.get(entries[1].entry.id)
    expect(cove?.scoredRevision).toBe(cove?.revision)
  })
})
