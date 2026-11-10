import { admin, agentA, curatorAgent } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import type { FactId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { createEntry, createSense } from './catalog'
import { curateFact } from './curation'
import { getFact, listFacts, retractFact, submitFact } from './facts'
import { reviewFact } from './review'

async function bankWorld() {
  const world = fakeWorld()
  const { entry } = await createEntry(world.deps, agentA, { lemma: 'bank' })
  const river = await createSense(world.deps, agentA, { entry_id: entry.id, pos: 'noun', gloss: 'land beside a river' })
  for (const job of world.queued.splice(0)) await reviewFact(world.deps, job.factId, job.traceId)
  world.llmCalls.length = 0
  world.jevCalls.length = 0
  return { world, entry, river: river.sense, riverGloss: river.fact }
}

const example = (subject: string, text: string) => ({
  kind: 'example' as const,
  subject_id: subject,
  payload: { text },
})
const curation = { reason: 'Checked against three learner dictionaries.' }

async function reviewed(world: Awaited<ReturnType<typeof bankWorld>>['world'], id: FactId) {
  world.queued.length = 0
  await reviewFact(world.deps, id, 't')
  return getFact(world.deps, id)
}

describe('curated writes', () => {
  it('publishes a curated fact at once with a curator review and asks no reviewer [spec: curation/direct-write]', async () => {
    const { world, river } = await bankWorld()
    const { fact, created } = await submitFact(world.deps, curatorAgent, {
      ...example(river.id, 'We sat on the bank.'),
      curation,
    })
    expect(created).toBe(true)
    expect(fact).toMatchObject({ status: 'published', author: 'agent:agent-c', revalidateSince: null })
    expect(fact.review).toMatchObject({
      reviewer: 'curator',
      model: 'agent:agent-c',
      verdict: 'pass',
      confidence: 1,
      reason: curation.reason,
    })
    expect(world.queued).toEqual([])
    expect(world.llmCalls).toEqual([])

    const again = await submitFact(world.deps, curatorAgent, { ...example(river.id, 'we sat on the BANK.'), curation })
    expect(again).toEqual({ fact, created: false })

    const correction = await submitFact(world.deps, admin, {
      ...example(river.id, 'We sat on the grassy bank.'),
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
})

describe('curateFact', () => {
  it('passes or fails pending, weak, and rejected facts with the curator review [spec: curation/settle]', async () => {
    const { world, river } = await bankWorld()
    const pending = (await submitFact(world.deps, agentA, example(river.id, 'Fish swam by the bank.'))).fact
    await expect(
      curateFact(world.deps, curatorAgent, pending.id, { verdict: 'pass', reason: 'Fine.' }),
    ).resolves.toMatchObject({
      status: 'published',
      review: { reviewer: 'curator', verdict: 'pass', confidence: 1, reason: 'Fine.' },
    })

    world.answerLlm(() => ({ model: 'm', verdict: 'uncertain', confidence: 0.6, reason: 'Unsure.' }))
    const weak = await reviewed(
      world,
      (await submitFact(world.deps, agentA, example(river.id, 'The bank flooded.'))).fact.id,
    )
    expect(weak.review?.verdict).toBe('uncertain')
    expect((await listFacts(world.deps, { weak: true }, { limit: 10 })).items.map((fact) => fact.id)).toEqual([weak.id])
    await curateFact(world.deps, curatorAgent, weak.id, { verdict: 'pass', reason: 'Correct.' })
    expect((await listFacts(world.deps, { weak: true }, { limit: 10 })).items).toEqual([])

    world.failReviews()
    const rejected = await reviewed(
      world,
      (await submitFact(world.deps, agentA, example(river.id, 'Bank on it.'))).fact.id,
    )
    expect(rejected.status).toBe('rejected')
    await expect(
      curateFact(world.deps, curatorAgent, rejected.id, { verdict: 'pass', reason: 'Idiomatic.' }),
    ).resolves.toMatchObject({ status: 'published', review: { reviewer: 'curator', verdict: 'pass' } })
    expect(world.queued).toEqual([])

    await expect(
      curateFact(world.deps, curatorAgent, rejected.id, { verdict: 'fail', reason: 'Wrong sense.' }),
    ).resolves.toMatchObject({
      status: 'rejected',
      review: { reviewer: 'curator', verdict: 'fail', reason: 'Wrong sense.' },
    })
    await expect(
      curateFact(world.deps, curatorAgent, rejected.id, { verdict: 'fail', reason: 'Again.' }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('refuses to pass a rejected fact whose content a live fact holds', async () => {
    const { world, river } = await bankWorld()
    world.failReviews()
    const rejected = await reviewed(world, (await submitFact(world.deps, agentA, example(river.id, 'A bank.'))).fact.id)
    world.passReviews()
    await submitFact(world.deps, admin, { ...example(river.id, 'A bank.'), curation })
    await expect(
      curateFact(world.deps, curatorAgent, rejected.id, { verdict: 'pass', reason: 'x' }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('conflicts when the fact changes while it is being curated', async () => {
    const { world, river } = await bankWorld()
    const { fact } = await submitFact(world.deps, agentA, example(river.id, 'The bank.'))
    world.deps.facts.transition = async () => false
    await expect(curateFact(world.deps, curatorAgent, fact.id, { verdict: 'fail', reason: 'x' })).rejects.toMatchObject(
      {
        code: 'conflict',
      },
    )
    await expect(
      submitFact(world.deps, curatorAgent, { ...example(river.id, 'Another.'), curation }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('is for curators only', async () => {
    const { world, river } = await bankWorld()
    const { fact } = await submitFact(world.deps, agentA, example(river.id, 'The bank.'))
    await expect(curateFact(world.deps, agentA, fact.id, { verdict: 'pass', reason: 'x' })).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(submitFact(world.deps, agentA, { ...example(river.id, 'Another.'), curation })).rejects.toMatchObject({
      code: 'forbidden',
    })
  })
})

describe('curated fact protection', () => {
  it('lets only a curator supersede, retract, or resubmit a curated fact [spec: curation/producer-protection]', async () => {
    const { world, river } = await bankWorld()
    const published = (await submitFact(world.deps, agentA, example(river.id, 'We fished from the bank.'))).fact
    await reviewed(world, published.id)
    await curateFact(world.deps, curatorAgent, published.id, { verdict: 'pass', reason: 'Good.' })

    await expect(
      submitFact(world.deps, agentA, { ...example(river.id, 'We fished off the bank.'), supersedes_id: published.id }),
    ).rejects.toMatchObject({ code: 'curated_fact', status: 403 })
    await expect(retractFact(world.deps, agentA, published.id)).rejects.toMatchObject({ code: 'curated_fact' })

    const failed = (await submitFact(world.deps, agentA, example(river.id, 'The bank lent money.'))).fact
    await curateFact(world.deps, curatorAgent, failed.id, { verdict: 'fail', reason: 'Wrong sense of bank.' })
    await expect(submitFact(world.deps, agentA, example(river.id, 'The bank lent money.'))).rejects.toMatchObject({
      code: 'curated_fact',
    })

    await expect(
      submitFact(world.deps, curatorAgent, example(river.id, 'The bank lent money.')),
    ).resolves.toMatchObject({
      created: true,
    })
    await expect(
      submitFact(world.deps, curatorAgent, {
        ...example(river.id, 'We fished off the bank.'),
        supersedes_id: published.id,
      }),
    ).resolves.toMatchObject({ created: true })
    await expect(retractFact(world.deps, admin, published.id)).resolves.toMatchObject({ status: 'retracted' })
  })

  it('never marks a curated fact when a gloss correction publishes', async () => {
    const { world, river, riverGloss } = await bankWorld()
    const curated = (await submitFact(world.deps, admin, { ...example(river.id, 'We sat on the bank.'), curation }))
      .fact
    const plain = (await submitFact(world.deps, agentA, example(river.id, 'The bank was muddy.'))).fact
    await reviewed(world, plain.id)
    const correction = await submitFact(world.deps, agentA, {
      kind: 'sense',
      subject_id: river.id,
      supersedes_id: riverGloss.id,
      payload: { gloss: 'the sloping land beside a river' },
    })
    await reviewFact(world.deps, correction.fact.id, 't')
    expect((await getFact(world.deps, curated.id)).revalidateSince).toBeNull()
    expect((await getFact(world.deps, plain.id)).revalidateSince).not.toBeNull()
  })
})
