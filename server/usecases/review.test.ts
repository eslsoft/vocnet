import { admin, agentA } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import type { FactId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { createEntry, createSense, getPublicEntry } from './catalog'
import { getFact, rereviewFact, submitFact } from './facts'
import { ReviewerTransportError } from './ports'
import { RECONCILE_AFTER_MS, reconcilePending, reviewFact } from './review'

async function drain(world: ReturnType<typeof fakeWorld>) {
  for (const job of world.queued.splice(0)) await reviewFact(world.deps, job.factId)
}

async function bankWorld() {
  const world = fakeWorld()
  const { entry, fact: entryFact } = await createEntry(world.deps, agentA, { lemma: 'bank' })
  const { sense, fact: gloss } = await createSense(world.deps, agentA, {
    entry_id: entry.id,
    pos: 'noun',
    gloss: 'land beside a river',
  })
  return { world, entry, entryFact, sense, gloss }
}

describe('reviewFact', () => {
  it('publishes a passing Jev review and records what was judged [spec: facts/review-publish]', async () => {
    const { world, entryFact } = await bankWorld()
    await expect(reviewFact(world.deps, entryFact.id)).resolves.toBe('published')
    const fact = await getFact(world.deps, entryFact.id)
    expect(fact.status).toBe('published')
    expect(fact.review).toMatchObject({
      reviewer: 'jev',
      model: 'jev-test',
      verdict: 'pass',
      confidence: 0.95,
      reason: 'Jev lemma=0.95',
      context: { subject: { lemma: 'bank' }, target: null },
      detail: { answers: { lemma: 0.95 } },
    })
    expect(world.jevCalls[0]?.state).toMatchObject({ fact: { id: entryFact.id, kind: 'entry' } })
  })

  it('publishes an uncertain review with its low confidence', async () => {
    const { world, gloss } = await bankWorld()
    world.answerJev(() => ({ model: 'jev-test', answers: { lexical: 0.55 } }))
    await expect(reviewFact(world.deps, gloss.id)).resolves.toBe('published')
    expect((await getFact(world.deps, gloss.id)).review).toMatchObject({ verdict: 'uncertain', confidence: 0.55 })
  })

  it('rejects a failing review', async () => {
    const { world, gloss } = await bankWorld()
    world.answerJev(() => ({ model: 'jev-test', answers: { lexical: 0.1 } }))
    await expect(reviewFact(world.deps, gloss.id)).resolves.toBe('rejected')
  })

  it('reviews judgment facts with the LLM against the current gloss', async () => {
    const { world, sense } = await bankWorld()
    const { fact } = await submitFact(world.deps, agentA, {
      kind: 'example',
      subject_id: sense.id,
      payload: { text: 'We sat on the bank.' },
    })
    await expect(reviewFact(world.deps, fact.id)).resolves.toBe('published')
    expect(world.llmCalls[0]?.user).toContain('meaning "land beside a river"')
    expect((await getFact(world.deps, fact.id)).review).toMatchObject({ reviewer: 'llm', reason: 'Looks right.' })
  })

  it('never waits for other facts: an example is reviewed while its gloss is still pending [spec: facts/independent]', async () => {
    const { world, sense, gloss } = await bankWorld()
    const { fact } = await submitFact(world.deps, agentA, {
      kind: 'example',
      subject_id: sense.id,
      payload: { text: 'x' },
    })
    await reviewFact(world.deps, fact.id)
    expect((await getFact(world.deps, gloss.id)).status).toBe('pending')
    expect((await getFact(world.deps, fact.id)).status).toBe('published')
  })

  it('rejects a meaning-dependent fact whose sense has no live gloss, without asking a reviewer', async () => {
    const { world, sense, gloss } = await bankWorld()
    world.answerJev(() => ({ model: 'jev-test', answers: { lexical: 0.1 } }))
    await reviewFact(world.deps, gloss.id)
    const { fact } = await submitFact(world.deps, agentA, {
      kind: 'example',
      subject_id: sense.id,
      payload: { text: 'x' },
    })
    await expect(reviewFact(world.deps, fact.id)).resolves.toBe('rejected')
    expect(world.llmCalls).toHaveLength(0)
    expect((await getFact(world.deps, fact.id)).review).toMatchObject({ model: 'none', verdict: 'fail' })
  })

  it('reviews a relation against both senses', async () => {
    const { world, entry, sense } = await bankWorld()
    const other = await createSense(world.deps, agentA, { entry_id: entry.id, pos: 'noun', gloss: 'a riverside' })
    const { fact } = await submitFact(world.deps, agentA, {
      kind: 'relation',
      subject_id: sense.id,
      payload: { type: 'synonym', target_sense_id: other.sense.id },
    })
    await reviewFact(world.deps, fact.id)
    expect(world.jevCalls[0]?.questions.relation).toContain('"a riverside"')
  })

  it('skips facts that are not pending, so duplicate deliveries change nothing [spec: facts/review-idempotent]', async () => {
    const { world, entryFact } = await bankWorld()
    await reviewFact(world.deps, entryFact.id)
    world.answerJev(() => ({ model: 'jev-test', answers: { lemma: 0.01 } }))
    await expect(reviewFact(world.deps, entryFact.id)).resolves.toBe('skipped')
    expect((await getFact(world.deps, entryFact.id)).status).toBe('published')
    await expect(reviewFact(world.deps, 'missing' as FactId)).resolves.toBe('skipped')
  })

  it('skips when another delivery decided the fact during review', async () => {
    const { world, entryFact } = await bankWorld()
    world.deps.facts.transition = async () => false
    await expect(reviewFact(world.deps, entryFact.id)).resolves.toBe('skipped')
  })

  it('leaves the fact pending and propagates reviewer transport errors [spec: facts/transport-retry]', async () => {
    const { world, entryFact } = await bankWorld()
    world.answerJev(() => {
      throw new ReviewerTransportError('Gateway down.')
    })
    await expect(reviewFact(world.deps, entryFact.id)).rejects.toBeInstanceOf(ReviewerTransportError)
    expect((await getFact(world.deps, entryFact.id)).status).toBe('pending')
  })

  it('supersedes the corrected fact when the correction publishes [spec: facts/correction]', async () => {
    const { world, sense, gloss } = await bankWorld()
    await drain(world)
    const { fact: correction } = await submitFact(world.deps, agentA, {
      kind: 'sense',
      subject_id: sense.id,
      supersedes_id: gloss.id,
      payload: { gloss: 'the sloping land beside a river' },
    })
    expect((await getFact(world.deps, gloss.id)).status).toBe('published')
    await drain(world)
    expect((await getFact(world.deps, gloss.id)).status).toBe('superseded')
    expect((await getFact(world.deps, correction.id)).status).toBe('published')
    const entry = await getPublicEntry(world.deps, 'bank')
    expect(entry.senses[0]?.gloss).toBe('the sloping land beside a river')
  })

  it('leaves the original published when its correction is rejected', async () => {
    const { world, sense, gloss } = await bankWorld()
    await drain(world)
    await submitFact(world.deps, agentA, {
      kind: 'sense',
      subject_id: sense.id,
      supersedes_id: gloss.id,
      payload: { gloss: 'a kind of fish' },
    })
    world.answerJev(() => ({ model: 'jev-test', answers: { lexical: 0.05 } }))
    await drain(world)
    expect((await getFact(world.deps, gloss.id)).status).toBe('published')
  })

  it('a re-reviewed rejected gloss cannot go live while another gloss holds the sense', async () => {
    const { world, sense, gloss } = await bankWorld()
    world.answerJev(() => ({ model: 'jev-test', answers: { lexical: 0.05 } }))
    await drain(world)
    world.answerJev((questions) => ({
      model: 'jev-test',
      answers: Object.fromEntries(Object.keys(questions).map((k) => [k, 0.9])),
    }))
    await submitFact(world.deps, agentA, { kind: 'sense', subject_id: sense.id, payload: { gloss: 'riverside land' } })
    await expect(rereviewFact(world.deps, admin, gloss.id)).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('broken references', () => {
  it('fails loudly instead of reviewing a fact whose node is missing', async () => {
    const { world, entryFact, gloss } = await bankWorld()
    world.senses.length = 0
    await expect(reviewFact(world.deps, gloss.id)).rejects.toThrow('does not exist')
    world.entries.length = 0
    await expect(reviewFact(world.deps, entryFact.id)).rejects.toThrow('does not exist')
  })
})

describe('reconcilePending', () => {
  it('re-enqueues facts pending longer than ten minutes [spec: facts/reconcile]', async () => {
    const { world, entryFact, gloss } = await bankWorld()
    world.queued.length = 0
    await expect(reconcilePending(world.deps, 'cron')).resolves.toBe(0)
    expect(world.queued).toEqual([])

    world.setNow(new Date(Date.parse(entryFact.createdAt) + RECONCILE_AFTER_MS + 1).toISOString())
    await expect(reconcilePending(world.deps, 'cron')).resolves.toBe(2)
    expect(world.queued).toEqual([
      { factId: entryFact.id, traceId: 'cron' },
      { factId: gloss.id, traceId: 'cron' },
    ])
  })
})
