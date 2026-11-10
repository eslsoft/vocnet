import { agentA } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import { publicEntryOf } from '@server/testing/public-view'
import type { EntryId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { createEntry, createSense, getPublicEntry } from './catalog'
import { retractFact, submitFact } from './facts'
import { readPublicView, rebuildStalePublicViews } from './public-view'
import { reviewFact } from './review'

async function reviewAll(world: ReturnType<typeof fakeWorld>) {
  for (const job of world.queued.splice(0)) await reviewFact(world.deps, job.factId, job.traceId)
}

/** "bank" and "shore", each with a published sense, linked by a published synonym relation. */
async function linkedWorld() {
  const world = fakeWorld()
  const bank = await createEntry(world.deps, agentA, { lemma: 'bank' })
  const shore = await createEntry(world.deps, agentA, { lemma: 'shore' })
  const river = await createSense(world.deps, agentA, {
    entry_id: bank.entry.id,
    pos: 'noun',
    gloss: 'land by a river',
  })
  const coast = await createSense(world.deps, agentA, { entry_id: shore.entry.id, pos: 'noun', gloss: 'land by water' })
  await submitFact(world.deps, agentA, {
    kind: 'relation',
    subject_id: river.sense.id,
    payload: { type: 'synonym', target_sense_id: coast.sense.id },
  })
  await reviewAll(world)
  return { world, bank, shore }
}

const markStale = (world: ReturnType<typeof fakeWorld>, entryId: EntryId) => {
  const row = world.work.get(entryId)
  if (!row) throw new Error(`No worklist row for ${entryId}.`)
  row.revision += 1
}

describe('public view refresh [spec: public-view/refresh]', () => {
  it('rebuilds the views a write makes stale, linked entries included, without a read', async () => {
    const { world, bank, shore } = await linkedWorld()
    expect(world.views.get(bank.entry.id)?.document.senses[0]?.relations).toHaveLength(1)
    for (const [, row] of world.work) expect(row.viewRevision).toBe(row.revision)

    await retractFact(world.deps, agentA, shore.fact.id)
    expect(world.views.has(shore.entry.id)).toBe(false)
    expect(world.views.get(bank.entry.id)?.document.senses[0]?.relations).toEqual([])
    await expect(getPublicEntry(world.deps, 'shore')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rebuilds a stale view on read before serving it', async () => {
    const { world, bank } = await linkedWorld()
    world.references.set('bank', { frequency: { zipf: 5.16, rank: 691, source_id: 'wordfreq' }, cefr: [] })
    expect((await publicEntryOf(world.deps, 'bank')).frequency).toBeNull()

    markStale(world, bank.entry.id)
    expect((await publicEntryOf(world.deps, 'bank')).frequency).toEqual({
      zipf: 5.16,
      rank: 691,
      source_id: 'wordfreq',
    })
    expect(world.work.get(bank.entry.id)?.viewRevision).toBe(world.work.get(bank.entry.id)?.revision)
  })

  it('serves nothing for a stale view that has no document after its rebuild', async () => {
    const { world, bank } = await linkedWorld()
    const pending = await createEntry(world.deps, agentA, { lemma: 'pending' })
    markStale(world, pending.entry.id)
    await expect(getPublicEntry(world.deps, 'pending')).rejects.toMatchObject({ code: 'not_found' })

    const lookups = [{ stale: { entryId: bank.entry.id, revision: 99 }, view: null }, null]
    expect(await readPublicView(world.deps, async () => lookups.shift() ?? null)).toBeNull()
  })

  it('serves the stored view when a write lands during the rebuild', async () => {
    const { world, bank } = await linkedWorld()
    const stored =
      (await readPublicView(world.deps, () => world.deps.publicViews.findByLemma(bank.entry.lemma))) ?? null
    const { save } = world.deps.publicViews
    world.deps.publicViews.save = async (stale, record) => {
      markStale(world, stale.entryId)
      await save(stale, record)
    }
    markStale(world, bank.entry.id)
    world.references.set('bank', { frequency: null, cefr: [{ pos: 'noun', level: 'A1', source_id: 'cefrj' }] })

    expect(await readPublicView(world.deps, () => world.deps.publicViews.findByLemma(bank.entry.lemma))).toEqual(stored)
    expect(await world.deps.publicViews.countStale()).toBe(1)
  })

  it('drains stale views a batch at a time and reports what is left', async () => {
    const { world, bank, shore } = await linkedWorld()
    markStale(world, bank.entry.id)
    markStale(world, shore.entry.id)

    await expect(rebuildStalePublicViews(world.deps, 1)).resolves.toEqual({ rebuilt: 1, remaining: 1 })
    await expect(rebuildStalePublicViews(world.deps, 10)).resolves.toEqual({ rebuilt: 1, remaining: 0 })
    await expect(rebuildStalePublicViews(world.deps, 10)).resolves.toEqual({ rebuilt: 0, remaining: 0 })
  })

  it('tries every view of the batch before it throws the failures', async () => {
    const { world, bank } = await linkedWorld()
    const ghost = '00000000-0000-4000-8000-0000000000ff' as EntryId
    const row = world.work.get(bank.entry.id)
    if (!row) throw new Error('No worklist row for bank.')
    world.work.set(ghost, { ...row, revision: 1, viewRevision: 0 })
    markStale(world, bank.entry.id)

    await expect(rebuildStalePublicViews(world.deps, 10)).rejects.toThrow('1 public views failed to rebuild.')
    expect(await world.deps.publicViews.listAnyStale(10)).toEqual([{ entryId: ghost, revision: 1 }])
  })
})
