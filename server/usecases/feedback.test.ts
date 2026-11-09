import { CLAIM_LEASE_MS } from '@server/domain/feedback'
import { admin, agentA, agentB } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import type { FactId } from '@shared/facts'
import type { FeedbackId } from '@shared/feedback'
import { describe, expect, it } from 'vitest'
import { createEntry, createSense } from './catalog'
import { claimFeedback, listFeedback, resolveFeedback, submitFeedback } from './feedback'

async function reported() {
  const world = fakeWorld()
  const { entry, fact } = await createEntry(world.deps, agentA, { lemma: 'bank' })
  const { sense } = await createSense(world.deps, agentA, { entry_id: entry.id, pos: 'noun', gloss: 'land' })
  const item = await submitFeedback(world.deps, {
    target_type: 'sense',
    target_id: sense.id,
    message: 'Gloss is vague.',
  })
  return { world, entry, sense, fact, item }
}

describe('submitFeedback', () => {
  it('records open feedback against an existing entry, sense, or fact [spec: feedback/submit]', async () => {
    const { world, entry, fact, item } = await reported()
    expect(item).toMatchObject({ status: 'open', assignee: null, revision: 0 })
    await submitFeedback(world.deps, { target_type: 'entry', target_id: entry.id, message: 'x' })
    await submitFeedback(world.deps, { target_type: 'fact', target_id: fact.id, message: 'x' })
    expect((await listFeedback(world.deps, { status: 'open' }, { limit: 10 })).items).toHaveLength(3)
  })

  it('rejects feedback about something that does not exist', async () => {
    const { world } = await reported()
    await expect(
      submitFeedback(world.deps, {
        target_type: 'fact',
        target_id: '00000000-0000-4000-8000-0000000000ff',
        message: 'x',
      }),
    ).rejects.toMatchObject({ code: 'invalid_reference' })
  })
})

describe('claimFeedback', () => {
  it('leases the item to one agent for an hour [spec: feedback/claim-lease]', async () => {
    const { world, item } = await reported()
    const claimed = await claimFeedback(world.deps, agentA, item.id)
    expect(claimed).toMatchObject({
      status: 'claimed',
      assignee: 'agent:agent-a',
      claimExpiresAt: '2026-01-01T01:00:00.000Z',
    })
    await expect(claimFeedback(world.deps, agentB, item.id)).rejects.toMatchObject({ code: 'conflict' })
    await expect(claimFeedback(world.deps, agentA, item.id)).resolves.toMatchObject({ assignee: 'agent:agent-a' })

    world.setNow(new Date(Date.parse('2026-01-01T00:00:00.000Z') + CLAIM_LEASE_MS).toISOString())
    await expect(claimFeedback(world.deps, agentB, item.id)).resolves.toMatchObject({ assignee: 'agent:agent-b' })
  })

  it('refuses closed or unknown items and concurrent claims', async () => {
    const { world, item } = await reported()
    await expect(claimFeedback(world.deps, agentA, 'missing' as FeedbackId)).rejects.toMatchObject({
      code: 'not_found',
    })
    world.deps.feedback.update = async () => false
    await expect(claimFeedback(world.deps, agentA, item.id)).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('resolveFeedback', () => {
  it('lets the holder resolve with correcting facts, and repeating it is a no-op [spec: feedback/resolve]', async () => {
    const { world, item, fact } = await reported()
    await claimFeedback(world.deps, agentA, item.id)
    const resolved = await resolveFeedback(world.deps, agentA, item.id, {
      resolution: 'resolved',
      fact_ids: [fact.id],
      note: 'Clarified.',
    })
    expect(resolved).toMatchObject({ status: 'resolved', resolutionFactIds: [fact.id], resolutionNote: 'Clarified.' })
    await expect(
      resolveFeedback(world.deps, agentA, item.id, { resolution: 'dismissed', note: 'again' }),
    ).resolves.toEqual(resolved)
    await expect(claimFeedback(world.deps, agentB, item.id)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('dismisses with a note and no facts', async () => {
    const { world, item } = await reported()
    await claimFeedback(world.deps, admin, item.id)
    await expect(
      resolveFeedback(world.deps, admin, item.id, { resolution: 'dismissed', note: 'Not a problem.' }),
    ).resolves.toMatchObject({ status: 'dismissed', resolutionFactIds: [], resolutionNote: 'Not a problem.' })
  })

  it('requires a claim held by the caller and existing facts', async () => {
    const { world, item } = await reported()
    const dismiss = { resolution: 'dismissed' as const, note: 'n' }
    await expect(resolveFeedback(world.deps, agentA, item.id, dismiss)).rejects.toMatchObject({ code: 'conflict' })
    await claimFeedback(world.deps, agentA, item.id)
    await expect(resolveFeedback(world.deps, agentB, item.id, dismiss)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      resolveFeedback(world.deps, agentA, item.id, { resolution: 'resolved', fact_ids: ['missing' as FactId] }),
    ).rejects.toMatchObject({ code: 'invalid_reference' })
  })
})
