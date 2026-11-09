import { agentA } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import type { EntryId, SenseId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import {
  createEntry,
  createSense,
  getManagedEntry,
  getPublicEntry,
  getPublicSense,
  getStats,
  lookupForm,
  searchEntries,
} from './catalog'
import { submitFact } from './facts'
import { reviewFact } from './review'

async function reviewAll(world: ReturnType<typeof fakeWorld>) {
  for (const job of world.queued.splice(0)) await reviewFact(world.deps, job.factId)
}

describe('createEntry', () => {
  it('creates the entry and submits its entry fact once [spec: catalog/create-entry]', async () => {
    const world = fakeWorld()
    const first = await createEntry(world.deps, agentA, { lemma: '  ice   cream ' })
    expect(first).toMatchObject({ created: true, entry: { lemma: 'ice cream', createdBy: 'agent:agent-a' } })
    expect(first.fact).toMatchObject({ kind: 'entry', status: 'pending', subjectId: first.entry.id })
    expect(world.queued).toEqual([{ factId: first.fact.id, traceId: 'trace-a' }])

    const again = await createEntry(world.deps, agentA, { lemma: 'ice cream' })
    expect(again).toMatchObject({ created: false, entry: { id: first.entry.id }, fact: { id: first.fact.id } })
    expect(world.entries).toHaveLength(1)
    expect(world.queued).toHaveLength(1)
  })
})

describe('createSense', () => {
  it('creates a sense with its gloss fact and is idempotent by entry, POS, and gloss [spec: catalog/create-sense]', async () => {
    const world = fakeWorld()
    const { entry } = await createEntry(world.deps, agentA, { lemma: 'bank' })
    const input = { entry_id: entry.id, pos: 'noun' as const, gloss: 'land beside a river' }
    const created = await createSense(world.deps, agentA, input)
    expect(created).toMatchObject({ created: true, sense: { entryId: entry.id, pos: 'noun' } })
    expect(created.fact).toMatchObject({ kind: 'sense', payload: { gloss: 'land beside a river' }, status: 'pending' })

    const again = await createSense(world.deps, agentA, { ...input, gloss: 'Land beside a  river' })
    expect(again).toMatchObject({ created: false, sense: { id: created.sense.id } })
    const verb = await createSense(world.deps, agentA, { ...input, pos: 'verb' })
    expect(verb.created).toBe(true)
  })

  it('rejects a sense for an unknown entry', async () => {
    const world = fakeWorld()
    await expect(
      createSense(world.deps, agentA, { entry_id: 'missing' as EntryId, pos: 'noun', gloss: 'x' }),
    ).rejects.toMatchObject({ code: 'invalid_reference' })
  })
})

describe('public reads', () => {
  async function publishedBank() {
    const world = fakeWorld()
    const { entry } = await createEntry(world.deps, agentA, { lemma: 'bank' })
    const { sense } = await createSense(world.deps, agentA, {
      entry_id: entry.id,
      pos: 'noun',
      gloss: 'land beside a river',
    })
    await submitFact(world.deps, agentA, {
      kind: 'form',
      subject_id: entry.id,
      payload: { form: 'banks', type: 'plural' },
    })
    await reviewAll(world)
    return { world, entry, sense }
  }

  it('returns a published entry and 404s an unknown lemma with no fallback [spec: catalog/no-fallback]', async () => {
    const { world } = await publishedBank()
    await expect(getPublicEntry(world.deps, 'bank')).resolves.toMatchObject({
      lemma: 'bank',
      forms: [{ form: 'banks' }],
    })
    await expect(getPublicEntry(world.deps, 'banks')).rejects.toMatchObject({ code: 'not_found' })
    await expect(getPublicEntry(world.deps, 'Bank')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('404s an entry that exists but is not yet published', async () => {
    const world = fakeWorld()
    await createEntry(world.deps, agentA, { lemma: 'pending' })
    await expect(getPublicEntry(world.deps, 'pending')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('finds entries by an exact published form only [spec: catalog/form-lookup]', async () => {
    const { world, entry } = await publishedBank()
    await expect(lookupForm(world.deps, 'banks')).resolves.toEqual([
      expect.objectContaining({
        entry: { id: entry.id, lemma: 'bank' },
        form: expect.objectContaining({ type: 'plural' }),
      }),
    ])
    await expect(lookupForm(world.deps, 'bankz')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('gets a published sense and 404s unknown or hidden ones', async () => {
    const { world, sense } = await publishedBank()
    await expect(getPublicSense(world.deps, sense.id)).resolves.toMatchObject({
      id: sense.id,
      entry: { lemma: 'bank' },
    })
    await expect(getPublicSense(world.deps, 'missing' as SenseId)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('searches published entries by normalized prefix', async () => {
    const { world } = await publishedBank()
    await createEntry(world.deps, agentA, { lemma: 'banner' })
    await expect(searchEntries(world.deps, ' ba', { limit: 10 })).resolves.toMatchObject({ items: [{ lemma: 'bank' }] })
  })
})

describe('management reads', () => {
  it('shows every fact in every status, without duplicating relations inside the entry', async () => {
    const world = fakeWorld()
    const { entry } = await createEntry(world.deps, agentA, { lemma: 'big' })
    const a = await createSense(world.deps, agentA, { entry_id: entry.id, pos: 'adjective', gloss: 'large' })
    const b = await createSense(world.deps, agentA, { entry_id: entry.id, pos: 'adjective', gloss: 'important' })
    await submitFact(world.deps, agentA, {
      kind: 'relation',
      subject_id: a.sense.id,
      payload: { type: 'synonym', target_sense_id: b.sense.id },
    })
    const view = await getManagedEntry(world.deps, 'big')
    expect(view.senses).toHaveLength(2)
    expect(view.facts.map((fact) => fact.kind).sort()).toEqual(['entry', 'relation', 'sense', 'sense'])
    expect(view.facts.every((fact) => fact.status === 'pending')).toBe(true)
    await expect(getManagedEntry(world.deps, 'small')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('counts facts by kind and status, and open feedback', async () => {
    const world = fakeWorld()
    await createEntry(world.deps, agentA, { lemma: 'cat' })
    await expect(getStats(world.deps)).resolves.toEqual({
      facts: [{ kind: 'entry', status: 'pending', count: 1 }],
      open_feedback: 0,
    })
  })
})
