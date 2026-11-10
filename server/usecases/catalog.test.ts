import { admin, agentA } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import { publicEntryOf } from '@server/testing/public-view'
import type { EntryId, FactId, SenseId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import {
  createEntry,
  createSense,
  getManagedEntry,
  getPublicSense,
  getStats,
  importCoreEntries,
  listEntrySummaries,
  locateNode,
  lookupForm,
  searchEntries,
} from './catalog'
import { submitFact } from './facts'
import { reviewFact } from './review'

async function reviewAll(world: ReturnType<typeof fakeWorld>) {
  for (const job of world.queued.splice(0)) await reviewFact(world.deps, job.factId, job.traceId)
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

  it('creates seed entries for the CEFR headwords without one, lowest level first, skipping single letters but "a" and "I" [spec: catalog/import-core]', async () => {
    const world = fakeWorld()
    const level = (level: 'A1' | 'B1') => ({
      frequency: null,
      cefr: [{ pos: 'noun' as const, level, source_id: 'cefrj' }],
    })
    for (const lemma of ['bank', 'a', 'I', 'x', 'cove']) world.references.set(lemma, level('A1'))
    world.references.set('according to', level('B1'))
    world.references.set('tide', { frequency: { zipf: 4, rank: 1, source_id: 'wordfreq' }, cefr: [] })
    await createEntry(world.deps, agentA, { lemma: 'cove' })

    expect(await importCoreEntries(world.deps, admin, 3)).toEqual({
      created: ['I', 'a', 'bank'],
      skipped: ['x'],
      remaining: 1,
    })
    expect(await importCoreEntries(world.deps, admin, 3)).toEqual({
      created: ['according to'],
      skipped: ['x'],
      remaining: 0,
    })
    expect(await importCoreEntries(world.deps, admin, 3)).toEqual({ created: [], skipped: ['x'], remaining: 0 })

    expect(world.entries.map((entry) => [entry.lemma, entry.createdBy])).toEqual([
      ['cove', 'agent:agent-a'],
      ['I', 'admin:admin-1'],
      ['a', 'admin:admin-1'],
      ['bank', 'admin:admin-1'],
      ['according to', 'admin:admin-1'],
    ])
    const facts = world.facts.filter((fact) => fact.kind === 'entry' && fact.author === 'admin:admin-1')
    expect(facts.map((fact) => fact.status)).toEqual(['pending', 'pending', 'pending', 'pending'])
    expect(world.queued.map((job) => job.factId)).toEqual(world.facts.map((fact) => fact.id))
    for (const lemma of ['I', 'a', 'bank', 'according to'])
      expect((await getManagedEntry(world.deps, lemma)).seed).toBe(true)
    expect((await getManagedEntry(world.deps, 'cove')).seed).toBe(false)
  })

  it('marks a new or existing entry as a seed entry and never unmarks it [spec: catalog/create-entry-seed]', async () => {
    const world = fakeWorld()
    for (const lemma of ['bank', 'cove']) await createEntry(world.deps, agentA, { lemma })
    const tide = await createEntry(world.deps, agentA, { lemma: 'tide', seed: true })
    expect(tide.created).toBe(true)
    const cove = await createEntry(world.deps, agentA, { lemma: 'cove', seed: true })
    expect(cove).toMatchObject({ created: false, fact: { kind: 'entry' } })
    await createEntry(world.deps, agentA, { lemma: 'tide', seed: false })
    await createEntry(world.deps, agentA, { lemma: 'tide' })
    const seeds = []
    for (const lemma of ['bank', 'cove', 'tide']) seeds.push((await getManagedEntry(world.deps, lemma)).seed)
    expect(seeds).toEqual([false, true, true])
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

  it('returns the existing sense for the same gloss with any register [spec: catalog/create-sense-register]', async () => {
    const world = fakeWorld()
    const { entry } = await createEntry(world.deps, agentA, { lemma: 'odd' })
    const input = { entry_id: entry.id, pos: 'adjective' as const, gloss: 'Not divisible by two.' }
    const created = await createSense(world.deps, agentA, input)
    await reviewAll(world)

    const formal = await createSense(world.deps, agentA, { ...input, register: 'formal' })
    expect(formal).toMatchObject({ created: false, sense: { id: created.sense.id }, fact: { id: created.fact.id } })
    expect(formal.fact.payload).toEqual({ gloss: 'Not divisible by two.' })

    const labelled = await createSense(world.deps, agentA, {
      ...input,
      gloss: 'Divisible by three.',
      register: 'technical',
    })
    expect(labelled.created).toBe(true)
    const relabelled = await createSense(world.deps, agentA, { ...input, gloss: 'divisible by  three.' })
    expect(relabelled).toMatchObject({ created: false, sense: { id: labelled.sense.id } })
    expect(world.senses).toHaveLength(2)
    expect(world.queued.map((job) => job.factId)).toEqual([labelled.fact.id])
  })

  it('returns the sense a gloss created even after that gloss was rejected, and enqueues nothing', async () => {
    const world = fakeWorld()
    const { entry } = await createEntry(world.deps, agentA, { lemma: 'bank' })
    const input = { entry_id: entry.id, pos: 'noun' as const, gloss: 'a kind of fish' }
    const created = await createSense(world.deps, agentA, input)
    world.failReviews()
    await reviewAll(world)

    const again = await createSense(world.deps, agentA, input)
    expect(again).toMatchObject({
      created: false,
      sense: { id: created.sense.id },
      fact: { id: created.fact.id, status: 'rejected' },
    })
    expect(world.senses).toHaveLength(1)
    expect(world.queued).toEqual([])
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
    await expect(publicEntryOf(world.deps, 'bank')).resolves.toMatchObject({
      lemma: 'bank',
      forms: [{ form: 'banks' }],
    })
    await expect(publicEntryOf(world.deps, 'banks')).rejects.toMatchObject({ code: 'not_found' })
    await expect(publicEntryOf(world.deps, 'Bank')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('404s an entry that exists but is not yet published', async () => {
    const world = fakeWorld()
    await createEntry(world.deps, agentA, { lemma: 'pending' })
    await expect(publicEntryOf(world.deps, 'pending')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('finds entries by an exact published form only [spec: catalog/form-lookup]', async () => {
    const { world, entry } = await publishedBank()
    await expect(lookupForm(world.deps, 'banks')).resolves.toEqual({
      matches: [
        expect.objectContaining({
          entry: { id: entry.id, lemma: 'bank' },
          form: expect.objectContaining({ type: 'plural' }),
        }),
      ],
      digests: [expect.any(String)],
    })
    await expect(lookupForm(world.deps, 'bankz')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('gets a published sense and 404s unknown or hidden ones', async () => {
    const { world, sense } = await publishedBank()
    await expect(getPublicSense(world.deps, sense.id)).resolves.toMatchObject({
      sense: { id: sense.id, entry: { lemma: 'bank' } },
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
  it('lists entries in every status by normalized prefix', async () => {
    const world = fakeWorld()
    for (const lemma of ['bank', 'banner', 'cat']) await createEntry(world.deps, agentA, { lemma })
    const page = await listEntrySummaries(world.deps, ' ba', { limit: 10 })
    expect(page.items.map(({ lemma, entry_status }) => ({ lemma, entry_status }))).toEqual([
      { lemma: 'bank', entry_status: 'pending' },
      { lemma: 'banner', entry_status: 'pending' },
    ])
  })

  it('shows every fact in every status, without duplicating a stored relation inside the entry', async () => {
    const world = fakeWorld()
    const { entry } = await createEntry(world.deps, agentA, { lemma: 'big' })
    const a = await createSense(world.deps, agentA, { entry_id: entry.id, pos: 'adjective', gloss: 'large' })
    const b = await createSense(world.deps, agentA, { entry_id: entry.id, pos: 'adjective', gloss: 'important' })
    // Submission now refuses relations inside one entry; facts stored before that rule still show once.
    await world.deps.facts.insert({
      ...a.fact,
      id: crypto.randomUUID() as FactId,
      kind: 'relation',
      subjectId: a.sense.id,
      objectId: b.sense.id,
      contentKey: `synonym|${b.sense.id}`,
      payload: { type: 'synonym', target_sense_id: b.sense.id },
    })
    const view = await getManagedEntry(world.deps, 'big')
    expect(view.seed).toBe(false)
    expect(view.senses).toHaveLength(2)
    expect(view.facts.map((fact) => fact.kind).sort()).toEqual(['entry', 'relation', 'sense', 'sense'])
    expect(view.facts.every((fact) => fact.status === 'pending')).toBe(true)
    await expect(getManagedEntry(world.deps, 'small')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('locates the entry that owns an entry or sense id, and 404s any other id', async () => {
    const world = fakeWorld()
    const { entry } = await createEntry(world.deps, agentA, { lemma: 'bank' })
    const { sense } = await createSense(world.deps, agentA, {
      entry_id: entry.id,
      pos: 'noun',
      gloss: 'land beside a river',
    })
    const owner = { id: entry.id, lemma: 'bank' }
    await expect(locateNode(world.deps, entry.id)).resolves.toEqual({ node_type: 'entry', entry: owner })
    await expect(locateNode(world.deps, sense.id)).resolves.toEqual({ node_type: 'sense', entry: owner })
    await expect(locateNode(world.deps, crypto.randomUUID())).rejects.toMatchObject({ code: 'not_found' })
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
