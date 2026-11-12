import type { Fact } from '@server/domain/fact'
import { admin, agentA, curatorAgent } from '@server/testing/actors'
import { type FakeWorld, fakeWorld } from '@server/testing/fakes'
import { headword } from '@server/testing/seed'
import type { FactId, SenseId, SubmitFactInput } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { curateFact } from './curation'
import { getFact, retractFact, submitFact } from './facts'
import { reviewFact } from './review'

async function bankWorld() {
  const world = fakeWorld()
  const bank = await headword(world, 'bank', [{ pos: 'noun', gloss: 'land beside a river' }])
  world.queued.length = 0
  world.llmCalls.length = 0
  world.decisionCalls.length = 0
  return { world, entry: bank.entry, river: bank.senses[0] as SenseId }
}

const example = (subject: string, text: string): SubmitFactInput => ({
  kind: 'example',
  subject_id: subject,
  payload: { text },
})
const curation = { reason: 'Checked against three learner dictionaries.' }

async function reviewed(world: FakeWorld, id: FactId): Promise<Fact> {
  world.queued.length = 0
  await reviewFact(world.deps, id, 't')
  return getFact(world.deps, id)
}

describe('curated writes', () => {
  it('publishes a curated fact at once with a curator review and asks no reviewer [spec: curation/direct-write]', async () => {
    const { world, river } = await bankWorld()
    const { fact, created } = await submitFact(world.deps, curatorAgent, {
      ...example(river, 'We sat on the bank.'),
      curation,
    })
    expect(created).toBe(true)
    expect(fact).toMatchObject({ status: 'published', author: 'agent:agent-c' })
    expect(fact.review).toMatchObject({
      reviewer: 'curator',
      model: 'agent:agent-c',
      verdict: 'pass',
      confidence: 1,
      reason: curation.reason,
    })
    expect(world.queued).toEqual([])
    expect(world.llmCalls).toEqual([])
    expect(world.decisionCalls).toEqual([])

    const again = await submitFact(world.deps, curatorAgent, { ...example(river, 'we sat on the BANK.'), curation })
    expect(again).toEqual({ fact, created: false })

    const correction = await submitFact(world.deps, admin, {
      ...example(river, 'We sat on the grassy bank.'),
      supersedes_id: fact.id,
      curation,
    })
    expect(correction.fact.status).toBe('published')
    expect((await getFact(world.deps, fact.id)).status).toBe('superseded')
  })

  it('keeps every submission rule for a curated fact', async () => {
    const { world, entry } = await bankWorld()
    await expect(
      submitFact(world.deps, curatorAgent, { ...example(entry.id, 'Not a sense.'), curation }),
    ).rejects.toMatchObject({ code: 'invalid_reference' })
  })

  it('is for curators only', async () => {
    const { world, river } = await bankWorld()
    await expect(submitFact(world.deps, agentA, { ...example(river, 'Another.'), curation })).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it('conflicts when the fact changes while it is being published', async () => {
    const { world, river } = await bankWorld()
    world.deps.facts.transition = async () => false
    await expect(
      submitFact(world.deps, curatorAgent, { ...example(river, 'Another.'), curation }),
    ).rejects.toMatchObject({ code: 'conflict', message: 'The fact changed while it was being published.' })
  })
})

describe('curateFact', () => {
  it('passes or fails pending, published, and rejected facts with the curator review [spec: curation/settle]', async () => {
    const { world, river } = await bankWorld()
    const pending = (await submitFact(world.deps, agentA, example(river, 'Fish swam by the bank.'))).fact
    await expect(
      curateFact(world.deps, curatorAgent, pending.id, { verdict: 'pass', reason: 'Fine.' }),
    ).resolves.toMatchObject({
      status: 'published',
      review: { reviewer: 'curator', verdict: 'pass', confidence: 1, reason: 'Fine.' },
    })

    const published = await reviewed(
      world,
      (await submitFact(world.deps, agentA, example(river, 'The bank flooded.'))).fact.id,
    )
    expect(published.status).toBe('published')
    await expect(
      curateFact(world.deps, curatorAgent, published.id, { verdict: 'fail', reason: 'Wrong sense.' }),
    ).resolves.toMatchObject({ status: 'rejected', review: { reviewer: 'curator', verdict: 'fail' } })

    world.failReviews()
    const rejected = await reviewed(
      world,
      (await submitFact(world.deps, agentA, example(river, 'Bank on it.'))).fact.id,
    )
    expect(rejected.status).toBe('rejected')
    await expect(
      curateFact(world.deps, curatorAgent, rejected.id, { verdict: 'pass', reason: 'Idiomatic.' }),
    ).resolves.toMatchObject({ status: 'published', review: { reviewer: 'curator', verdict: 'pass' } })
    expect(world.queued).toEqual([])

    await curateFact(world.deps, curatorAgent, rejected.id, { verdict: 'fail', reason: 'Wrong sense.' })
    await expect(
      curateFact(world.deps, curatorAgent, rejected.id, { verdict: 'fail', reason: 'Again.' }),
    ).rejects.toMatchObject({ code: 'conflict', message: 'A rejected fact cannot be curated to fail.' })
  })

  it('publishing a curated correction retires its original', async () => {
    const { world, river } = await bankWorld()
    const original = await reviewed(world, (await submitFact(world.deps, agentA, example(river, 'A bank.'))).fact.id)
    const { fact } = await submitFact(world.deps, agentA, {
      ...example(river, 'A grassy bank.'),
      supersedes_id: original.id,
    })
    await curateFact(world.deps, curatorAgent, fact.id, { verdict: 'pass', reason: 'Better.' })
    expect((await getFact(world.deps, original.id)).status).toBe('superseded')
  })

  it('refuses to pass a rejected fact whose content a live fact holds', async () => {
    const { world, river } = await bankWorld()
    world.failReviews()
    const rejected = await reviewed(world, (await submitFact(world.deps, agentA, example(river, 'A bank.'))).fact.id)
    world.passReviews()
    await submitFact(world.deps, admin, { ...example(river, 'A bank.'), curation })
    await expect(
      curateFact(world.deps, curatorAgent, rejected.id, { verdict: 'pass', reason: 'x' }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('conflicts when the fact changes while it is being curated', async () => {
    const { world, river } = await bankWorld()
    const { fact } = await submitFact(world.deps, agentA, example(river, 'The bank.'))
    world.deps.facts.transition = async () => false
    await expect(curateFact(world.deps, curatorAgent, fact.id, { verdict: 'fail', reason: 'x' })).rejects.toMatchObject(
      { code: 'conflict', message: 'The fact changed while it was being curated.' },
    )
  })

  it('is for curators only', async () => {
    const { world, river } = await bankWorld()
    const { fact } = await submitFact(world.deps, agentA, example(river, 'The bank.'))
    await expect(curateFact(world.deps, agentA, fact.id, { verdict: 'pass', reason: 'x' })).rejects.toMatchObject({
      code: 'forbidden',
    })
  })
})

describe('curated fact protection', () => {
  it('lets only a curator supersede, retract, or resubmit a curated fact [spec: curation/producer-protection]', async () => {
    const { world, river } = await bankWorld()
    const published = await reviewed(
      world,
      (await submitFact(world.deps, agentA, example(river, 'We fished from the bank.'))).fact.id,
    )
    await curateFact(world.deps, curatorAgent, published.id, { verdict: 'pass', reason: 'Good.' })

    await expect(
      submitFact(world.deps, agentA, { ...example(river, 'We fished off the bank.'), supersedes_id: published.id }),
    ).rejects.toMatchObject({ code: 'curated_fact', status: 403 })
    await expect(retractFact(world.deps, agentA, published.id)).rejects.toMatchObject({ code: 'curated_fact' })

    const failed = (await submitFact(world.deps, agentA, example(river, 'The bank lent money.'))).fact
    await curateFact(world.deps, curatorAgent, failed.id, { verdict: 'fail', reason: 'Wrong sense of bank.' })
    await expect(submitFact(world.deps, agentA, example(river, 'The bank lent money.'))).rejects.toMatchObject({
      code: 'curated_fact',
    })

    await expect(submitFact(world.deps, curatorAgent, example(river, 'The bank lent money.'))).resolves.toMatchObject({
      created: true,
    })
    await expect(
      submitFact(world.deps, curatorAgent, {
        ...example(river, 'We fished off the bank.'),
        supersedes_id: published.id,
      }),
    ).resolves.toMatchObject({ created: true })
    await expect(retractFact(world.deps, admin, published.id)).resolves.toMatchObject({ status: 'retracted' })
  })
})
