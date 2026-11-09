import { admin, agentA } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import type { FactId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { createEntry, createSense, getPublicEntry } from './catalog'
import { getFact, rereviewFact, retractFact, submitFact } from './facts'
import { ReviewerTransportError } from './ports'
import { reconcileReviews, reviewFact } from './review'

async function drain(world: ReturnType<typeof fakeWorld>) {
  for (const job of world.queued.splice(0)) await reviewFact(world.deps, job.factId, job.traceId)
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
    await expect(reviewFact(world.deps, entryFact.id, 'trace-review')).resolves.toBe('published')
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
    await expect(reviewFact(world.deps, gloss.id, 'trace-review')).resolves.toBe('published')
    expect((await getFact(world.deps, gloss.id)).review).toMatchObject({ verdict: 'uncertain', confidence: 0.55 })
  })

  it('rejects a failing review', async () => {
    const { world, gloss } = await bankWorld()
    world.answerJev(() => ({ model: 'jev-test', answers: { lexical: 0.1 } }))
    await expect(reviewFact(world.deps, gloss.id, 'trace-review')).resolves.toBe('rejected')
  })

  it('reviews judgment facts with the LLM against the current gloss', async () => {
    const { world, sense } = await bankWorld()
    const { fact } = await submitFact(world.deps, agentA, {
      kind: 'example',
      subject_id: sense.id,
      payload: { text: 'We sat on the bank.' },
    })
    await expect(reviewFact(world.deps, fact.id, 'trace-review')).resolves.toBe('published')
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
    await reviewFact(world.deps, fact.id, 'trace-review')
    expect((await getFact(world.deps, gloss.id)).status).toBe('pending')
    expect((await getFact(world.deps, fact.id)).status).toBe('published')
  })

  it('rejects a meaning-dependent fact whose sense has no live gloss, without asking a reviewer', async () => {
    const { world, sense, gloss } = await bankWorld()
    world.answerJev(() => ({ model: 'jev-test', answers: { lexical: 0.1 } }))
    await reviewFact(world.deps, gloss.id, 'trace-review')
    const { fact } = await submitFact(world.deps, agentA, {
      kind: 'example',
      subject_id: sense.id,
      payload: { text: 'x' },
    })
    await expect(reviewFact(world.deps, fact.id, 'trace-review')).resolves.toBe('rejected')
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
    await reviewFact(world.deps, fact.id, 'trace-review')
    expect(world.jevCalls[0]?.questions.relation).toContain('"a riverside"')
  })

  it('skips facts that are not pending, so duplicate deliveries change nothing [spec: facts/review-idempotent]', async () => {
    const { world, entryFact } = await bankWorld()
    await reviewFact(world.deps, entryFact.id, 'trace-review')
    world.answerJev(() => ({ model: 'jev-test', answers: { lemma: 0.01 } }))
    await expect(reviewFact(world.deps, entryFact.id, 'trace-review')).resolves.toBe('skipped')
    expect((await getFact(world.deps, entryFact.id)).status).toBe('published')
    await expect(reviewFact(world.deps, 'missing' as FactId, 'trace-review')).resolves.toBe('skipped')
  })

  it('skips when another delivery decided the fact during review', async () => {
    const { world, entryFact } = await bankWorld()
    world.deps.facts.transition = async () => false
    await expect(reviewFact(world.deps, entryFact.id, 'trace-review')).resolves.toBe('skipped')
  })

  it('leaves the fact pending and propagates reviewer transport errors [spec: facts/transport-retry]', async () => {
    const { world, entryFact } = await bankWorld()
    world.answerJev(() => {
      throw new ReviewerTransportError('Gateway down.')
    })
    await expect(reviewFact(world.deps, entryFact.id, 'trace-review')).rejects.toBeInstanceOf(ReviewerTransportError)
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
    await expect(reviewFact(world.deps, gloss.id, 'trace-review')).rejects.toThrow('does not exist')
    world.entries.length = 0
    await expect(reviewFact(world.deps, entryFact.id, 'trace-review')).rejects.toThrow('does not exist')
  })
})

async function correctedRiverBank() {
  const { world, sense: river, gloss } = await bankWorld()
  const { entry: shoreEntry } = await createEntry(world.deps, agentA, { lemma: 'shore' })
  const { sense: shore } = await createSense(world.deps, agentA, {
    entry_id: shoreEntry.id,
    pos: 'noun',
    gloss: 'land along water',
  })
  const submit = async (input: Parameters<typeof submitFact>[2]) => (await submitFact(world.deps, agentA, input)).fact
  const dependents = [
    await submit({ kind: 'example', subject_id: river.id, payload: { text: 'We sat on the bank.' } }),
    await submit({ kind: 'translation', subject_id: river.id, payload: { language: 'fr', text: 'rive' } }),
    await submit({ kind: 'relation', subject_id: river.id, payload: { type: 'synonym', target_sense_id: shore.id } }),
    await submit({ kind: 'relation', subject_id: shore.id, payload: { type: 'synonym', target_sense_id: river.id } }),
  ]
  const unrelated = await submit({ kind: 'example', subject_id: shore.id, payload: { text: 'Waves hit the shore.' } })
  await drain(world)
  const correction = await submit({
    kind: 'sense',
    subject_id: river.id,
    supersedes_id: gloss.id,
    payload: { gloss: 'the sloping land beside a river' },
  })
  world.setNow('2026-01-01T00:05:00.000Z')
  await drain(world)
  return { world, river, gloss, correction, dependents, unrelated }
}

describe('revalidation', () => {
  it('re-reviews published facts judged against a corrected gloss while they stay public [spec: facts/revalidate-dependents]', async () => {
    const { world, correction, dependents, unrelated } = await correctedRiverBank()
    expect((await getFact(world.deps, correction.id)).status).toBe('published')
    expect(world.queued.map((job) => job.factId).sort()).toEqual(dependents.map((fact) => fact.id).sort())
    expect(world.queued.every((job) => job.traceId === 'trace-a')).toBe(true)
    for (const fact of dependents) {
      expect(await getFact(world.deps, fact.id)).toMatchObject({
        status: 'published',
        revalidateSince: '2026-01-01T00:05:00.000Z',
      })
    }
    expect((await getFact(world.deps, unrelated.id)).revalidateSince).toBeNull()
    const visible = (await getPublicEntry(world.deps, 'bank')).senses[0]
    expect([visible?.examples.length, visible?.translations.length, visible?.relations.length]).toEqual([1, 1, 2])

    world.setNow('2026-01-01T00:06:00.000Z')
    await drain(world)
    const example = await getFact(world.deps, dependents[0]?.id as FactId)
    expect(example).toMatchObject({ status: 'published', revalidateSince: null })
    expect(example.review).toMatchObject({
      reviewed_at: '2026-01-01T00:06:00.000Z',
      context: { subject: { gloss: 'the sloping land beside a river' } },
    })
    expect(world.llmCalls.at(-1)?.user).toContain('the sloping land beside a river')
  })

  it('rejects a dependent whose new review fails and keeps the rest', async () => {
    const { world, dependents } = await correctedRiverBank()
    world.answerLlm(() => ({ model: 'llm-test', verdict: 'fail', confidence: 0.9, reason: 'Other sense.' }))
    await drain(world)
    const statuses = await Promise.all(dependents.map(async (fact) => (await getFact(world.deps, fact.id)).status))
    expect(statuses).toEqual(['rejected', 'rejected', 'published', 'published'])
    const visible = (await getPublicEntry(world.deps, 'bank')).senses[0]
    expect([visible?.examples.length, visible?.translations.length]).toEqual([0, 0])
  })

  it('skips a revalidation whose gloss was corrected again while it was being reviewed', async () => {
    const { world, river, correction, dependents } = await correctedRiverBank()
    const id = dependents[0]?.id as FactId
    world.answerLlm(async () => {
      world.answerLlm(() => ({ model: 'llm-test', verdict: 'pass', confidence: 0.9, reason: 'Fine.' }))
      world.setNow('2026-01-01T00:07:00.000Z')
      const { fact: again } = await submitFact(world.deps, agentA, {
        kind: 'sense',
        subject_id: river.id,
        supersedes_id: correction.id,
        payload: { gloss: 'the ground at the edge of a river' },
      })
      await reviewFact(world.deps, again.id, 't')
      return { model: 'llm-test', verdict: 'pass', confidence: 0.9, reason: 'Fine.' }
    })
    await expect(reviewFact(world.deps, id, 't')).resolves.toBe('skipped')
    expect((await getFact(world.deps, id)).revalidateSince).toBe('2026-01-01T00:07:00.000Z')
  })

  it('settles once, so a second delivery changes nothing', async () => {
    const { world, dependents } = await correctedRiverBank()
    const id = dependents[0]?.id as FactId
    await expect(reviewFact(world.deps, id, 't')).resolves.toBe('published')
    await expect(reviewFact(world.deps, id, 't')).resolves.toBe('skipped')
  })

  it('releases dependents without a verdict when the correction is retracted before they revalidate', async () => {
    const { world, correction, dependents } = await correctedRiverBank()
    const before = await Promise.all(dependents.map((fact) => getFact(world.deps, fact.id)))
    await retractFact(world.deps, agentA, correction.id)
    const llmCalls = world.llmCalls.length
    const jevCalls = world.jevCalls.length
    world.setNow('2026-01-01T00:06:00.000Z')
    await drain(world)
    for (const fact of before) {
      expect(await getFact(world.deps, fact.id)).toMatchObject({
        status: 'published',
        revalidateSince: null,
        review: fact.review,
      })
    }
    expect([world.llmCalls.length, world.jevCalls.length]).toEqual([llmCalls, jevCalls])
  })

  it('does not cascade when a gloss is retracted [spec: facts/retract-no-cascade]', async () => {
    const { world, river, dependents } = await correctedRiverBank()
    await drain(world)
    const current = world.facts.find(
      (fact) => fact.kind === 'sense' && fact.subjectId === river.id && fact.status === 'published',
    )
    await retractFact(world.deps, agentA, current?.id as FactId)
    expect(world.queued).toEqual([])
    for (const fact of dependents) expect((await getFact(world.deps, fact.id)).revalidateSince).toBeNull()
    expect((await getPublicEntry(world.deps, 'bank')).senses).toEqual([])
  })
})

const FIVE_MINUTES_MS = 5 * 60 * 1000

describe('reconcileReviews', () => {
  it('re-enqueues facts pending longer than five minutes [spec: facts/reconcile]', async () => {
    const { world, entryFact, gloss } = await bankWorld()
    world.queued.length = 0
    await expect(reconcileReviews(world.deps, 'cron')).resolves.toBe(0)
    expect(world.queued).toEqual([])

    world.setNow(new Date(Date.parse(entryFact.createdAt) + FIVE_MINUTES_MS + 1).toISOString())
    await expect(reconcileReviews(world.deps, 'cron')).resolves.toBe(2)
    expect(world.queued).toEqual([
      { factId: entryFact.id, traceId: 'cron' },
      { factId: gloss.id, traceId: 'cron' },
    ])
  })

  it('re-enqueues facts awaiting revalidation for longer than five minutes [spec: facts/reconcile-revalidation]', async () => {
    const { world, dependents } = await correctedRiverBank()
    world.queued.length = 0
    world.setNow(new Date(Date.parse('2026-01-01T00:05:00.000Z') + FIVE_MINUTES_MS - 1).toISOString())
    await expect(reconcileReviews(world.deps, 'cron')).resolves.toBe(0)
    world.setNow(new Date(Date.parse('2026-01-01T00:05:00.000Z') + FIVE_MINUTES_MS + 1).toISOString())
    await expect(reconcileReviews(world.deps, 'cron')).resolves.toBe(dependents.length)
  })
})
