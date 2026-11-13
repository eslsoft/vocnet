import { admin, agentA, curatorAgent } from '@server/testing/actors'
import { type FakeWorld, fakeWorld } from '@server/testing/fakes'
import { drainReviews, headword } from '@server/testing/seed'
import type { EntryId, FactId, SenseId } from '@shared/facts'
import type { SubmitFeedbackInput, TicketId } from '@shared/tickets'
import { describe, expect, it } from 'vitest'
import { submitFact } from './facts'
import { getTicketWithEntry, listTickets, resolveTicket, settleSlot, submitFeedback } from './tickets'

const missing = '00000000-0000-4000-8000-0000000000ff'

/** "cat" with a published sense, its translation, an example of it, and the example's translation, all published. */
async function catWorld() {
  const world = fakeWorld()
  const { entry, senses } = await headword(world, 'cat', [{ pos: 'noun', gloss: 'a small furry animal kept as a pet' }])
  const sense = senses[0] as SenseId
  const example = await submitFact(world.deps, agentA, {
    kind: 'example',
    subject_id: sense,
    payload: { text: 'The cat slept.' },
  })
  await drainReviews(world)
  const translation = await submitFact(world.deps, agentA, {
    kind: 'translation',
    subject_id: example.fact.objectId as string,
    payload: { language: 'zh', of: 'sentence', text: '猫睡了。' },
  })
  const gloss = await submitFact(world.deps, agentA, {
    kind: 'translation',
    subject_id: sense,
    payload: { language: 'zh', of: 'sense', text: '猫' },
  })
  await drainReviews(world)
  return { world, entry, sense, example: example.fact.id, translation: translation.fact.id, gloss: gloss.fact.id }
}

const report = (world: FakeWorld, input: Omit<SubmitFeedbackInput, 'message'>, client = '203.0.113.1') =>
  submitFeedback(world.deps, client, { ...input, message: 'This looks wrong.' })

describe('submitFeedback', () => {
  it('opens a feedback ticket on a public entry, sense, or fact [spec: feedback/submit] [spec: tickets/feedback]', async () => {
    const { world, entry, sense, example, gloss } = await catWorld()
    const onEntry = await report(world, { target_type: 'entry', target_id: entry.id })
    expect(onEntry).toMatchObject({
      type: 'feedback',
      targetType: 'entry',
      target: entry.id,
      message: 'This looks wrong.',
      status: 'open',
      revision: 0,
      resolutionFactIds: [],
    })
    await report(world, { target_type: 'sense', target_id: sense })
    await report(world, { target_type: 'fact', target_id: example })
    await report(world, { target_type: 'fact', target_id: gloss })
    expect(world.tickets.map((ticket) => ticket.targetType)).toEqual(['entry', 'sense', 'fact', 'fact'])
    // A target keeps its one open feedback ticket.
    await expect(report(world, { target_type: 'entry', target_id: entry.id })).resolves.toEqual(onEntry)
    expect(world.tickets).toHaveLength(4)
  })

  it('reports only what the public API shows [spec: feedback/public-target]', async () => {
    const { world, sense, example, translation, gloss } = await catWorld()
    const { entry: bare } = await headword(world, 'dog')
    const pending = await submitFact(world.deps, agentA, {
      kind: 'example',
      subject_id: sense,
      payload: { text: 'My cat purrs.' },
    })
    const refused = [
      { target_type: 'entry', target_id: bare.id },
      { target_type: 'entry', target_id: missing },
      { target_type: 'sense', target_id: missing },
      { target_type: 'fact', target_id: missing },
      { target_type: 'fact', target_id: pending.fact.id },
      // The document shows an example's translation as text, with no fact id to report.
      { target_type: 'fact', target_id: translation },
    ] as const
    for (const target of refused) await expect(report(world, target)).rejects.toMatchObject({ code: 'not_found' })
    // A collocation's translation is shown as text with no fact id either.
    const collocation = await submitFact(world.deps, agentA, {
      kind: 'collocation',
      subject_id: sense,
      payload: { text: 'the cat purred', pattern: 'subject_verb' },
    })
    const collocated = await submitFact(world.deps, agentA, {
      kind: 'translation',
      subject_id: collocation.fact.id,
      payload: { language: 'zh', of: 'collocation', text: '猫咕噜叫。' },
    })
    await drainReviews(world)
    await expect(report(world, { target_type: 'fact', target_id: collocated.fact.id })).rejects.toMatchObject({
      code: 'not_found',
    })
    world.facts.splice(
      world.facts.findIndex((fact) => fact.id === collocation.fact.id),
      1,
    )
    await expect(report(world, { target_type: 'fact', target_id: collocated.fact.id })).rejects.toMatchObject({
      code: 'not_found',
    })
    // A translation of a sentence no example uses any more belongs to no entry.
    world.facts.splice(
      world.facts.findIndex((fact) => fact.id === example),
      1,
    )
    await expect(report(world, { target_type: 'fact', target_id: translation })).rejects.toMatchObject({
      code: 'not_found',
    })
    // An example whose sense row is gone belongs to no entry either.
    world.senses.splice(0)
    await expect(report(world, { target_type: 'fact', target_id: gloss })).rejects.toMatchObject({ code: 'not_found' })
    expect(world.tickets).toEqual([])
  })

  it('refuses a client over its allowance', async () => {
    const { world, entry } = await catWorld()
    world.limitedClients.add('198.51.100.7')
    await expect(report(world, { target_type: 'entry', target_id: entry.id }, '198.51.100.7')).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfter: 60,
    })
  })
})

describe('tickets', () => {
  async function ticketed() {
    const fixture = await catWorld()
    const ticket = await report(fixture.world, { target_type: 'fact', target_id: fixture.example })
    return { ...fixture, ticket }
  }

  it('lists tickets by status and type with their entries, and reads one, for curators only', async () => {
    const { world, entry, ticket } = await ticketed()
    const page = await listTickets(world.deps, curatorAgent, { status: 'open', type: 'feedback' }, { limit: 10 })
    expect(page).toEqual({ items: [{ ...ticket, entry: { id: entry.id, lemma: 'cat' } }], nextCursor: null })
    expect((await listTickets(world.deps, admin, { type: 'stuck_work' }, { limit: 10 })).items).toEqual([])
    await expect(getTicketWithEntry(world.deps, curatorAgent, ticket.id)).resolves.toMatchObject({
      entry: { id: entry.id },
    })
    await expect(getTicketWithEntry(world.deps, curatorAgent, missing as TicketId)).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(listTickets(world.deps, agentA, {}, { limit: 10 })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(getTicketWithEntry(world.deps, agentA, ticket.id)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('lets a curator resolve a ticket with the facts that fixed it, or dismiss it, once [spec: tickets/resolve]', async () => {
    const { world, ticket, gloss: translation } = await ticketed()
    await expect(
      resolveTicket(world.deps, agentA, ticket.id, { resolution: 'dismissed', note: 'fine' }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      resolveTicket(world.deps, admin, missing as TicketId, { resolution: 'dismissed', note: 'fine' }),
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      resolveTicket(world.deps, admin, ticket.id, {
        resolution: 'resolved',
        note: 'fixed',
        fact_ids: [missing as FactId],
      }),
    ).rejects.toMatchObject({ code: 'invalid_reference' })

    world.setNow('2026-01-02T00:00:00.000Z')
    const resolved = await resolveTicket(world.deps, curatorAgent, ticket.id, {
      resolution: 'resolved',
      note: 'Corrected the translation.',
      fact_ids: [translation],
    })
    expect(resolved).toMatchObject({
      status: 'resolved',
      resolutionNote: 'Corrected the translation.',
      resolutionFactIds: [translation],
      revision: 1,
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
    expect(world.tickets[0]).toEqual(resolved)
    await expect(
      resolveTicket(world.deps, admin, ticket.id, { resolution: 'dismissed', note: 'again' }),
    ).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('already resolved') })
  })

  it('dismisses with no facts, and conflicts when another write lands first', async () => {
    const { world, ticket } = await ticketed()
    const update = world.deps.tickets.update
    world.deps.tickets.update = async () => false
    await expect(
      resolveTicket(world.deps, admin, ticket.id, { resolution: 'dismissed', note: 'fine' }),
    ).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('changed') })
    world.deps.tickets.update = update
    await expect(
      resolveTicket(world.deps, admin, ticket.id, { resolution: 'dismissed', note: 'Reads correctly.' }),
    ).resolves.toMatchObject({ status: 'dismissed', resolutionFactIds: [] })
  })
})

describe('settleSlot', () => {
  it('lets a curator settle a slot by hand, which closes its item [spec: tickets/settle-slot]', async () => {
    const { world, entry } = await catWorld()
    expect(world.items.some((item) => item.type === 'morphology')).toBe(true)
    const slot = { entryId: entry.id, type: 'morphology' as const, subjectId: entry.id, note: 'A simple root word.' }
    await expect(settleSlot(world.deps, agentA, slot)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(settleSlot(world.deps, admin, { ...slot, entryId: missing as EntryId })).rejects.toMatchObject({
      code: 'not_found',
    })
    await settleSlot(world.deps, admin, slot)
    expect(world.passes).toMatchObject([
      { entryId: entry.id, type: 'morphology', note: 'A simple root word.', holder: 'admin:admin-1' },
    ])
    expect(world.items.some((item) => item.type === 'morphology')).toBe(false)
  })
})
