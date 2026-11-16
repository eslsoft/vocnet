import type { Fact } from '@server/domain/fact'
import { agentA } from '@server/testing/actors'
import { type FakeWorld, fakeWorld } from '@server/testing/fakes'
import { headword } from '@server/testing/seed'
import { describe, expect, it } from 'vitest'
import { classifyWork } from './classify'
import { ReviewerProtocolError, ReviewerTransportError } from './ports'
import { claimWork } from './work'

/** Jev's score for each question key, per part of speech; a key missing scores 0. */
const jevScores =
  (byPos: Record<string, Record<string, number>>) =>
  (questions: Record<string, string>, state: Readonly<Record<string, unknown>>) => ({
    model: 'jev-test',
    answers: Object.fromEntries(
      Object.keys(questions).map((key) => [key, byPos[String(state['part of speech'])]?.[key] ?? 0]),
    ),
  })
const ACTIVE = { native_active: 0.95, native_passive: 0.1, learner_active: 0.9, learner_passive: 0.2 }

async function runWorld() {
  const world = fakeWorld()
  const run = await headword(world, 'run', [
    { pos: 'verb', gloss: 'To move fast on foot.' },
    { pos: 'noun', gloss: 'An act of running.', register: 'informal' },
    { pos: 'adjective', gloss: 'Melted.', rank: 'extra' },
  ])
  world.decisionCalls.length = 0
  world.llmCalls.length = 0
  return { world, run }
}

const uses = (world: FakeWorld) =>
  world.facts.filter((fact): fact is Fact & { kind: 'productive_use' } => fact.kind === 'productive_use')
const openItems = (world: FakeWorld) => world.items.filter((item) => item.type === 'productive_use')

describe('classifyWork', () => {
  it('publishes the values Jev settles and the LLM chooses the rest, as the classifier [spec: work/classify]', async () => {
    const { world, run } = await runWorld()
    expect(openItems(world).map((item) => item.gap)).toEqual([{ type: 'productive_use', missing: ['verb', 'noun'] }])
    world.answerDecision(
      'jev',
      jevScores({ verb: ACTIVE, noun: { ...ACTIVE, learner_active: 0.5, learner_passive: 0.6 } }),
    )
    world.chooseLlm(() => ({
      native: true,
      learner: false,
      confidence: 0.7,
      reason: 'Informal; recognition is enough.',
    }))

    const tally = await classifyWork(world.deps, 'trace-cron', 60_000)
    expect(tally).toEqual({ items: 1, decided: 1, chosen: 1, refused: 0 })
    expect(
      uses(world).map(({ subjectId, payload, status, author, review }) => ({
        subjectId,
        payload,
        status,
        author,
        reviewer: review?.reviewer,
        confidence: review?.confidence,
      })),
    ).toEqual([
      {
        subjectId: run.entry.id,
        payload: { pos: 'verb', native: true, learner: true },
        status: 'published',
        author: 'system:classifier',
        reviewer: 'jev',
        confidence: 0.9,
      },
      {
        subjectId: run.entry.id,
        payload: { pos: 'noun', native: true, learner: false },
        status: 'published',
        author: 'system:classifier',
        reviewer: 'jev+llm',
        confidence: 0.7,
      },
    ])
    // Jev was asked each tier both ways round, about the common senses of the part of speech.
    const [first] = world.decisionCalls
    expect(Object.keys(first?.questions ?? {}).sort()).toEqual([
      'learner_active',
      'learner_passive',
      'native_active',
      'native_passive',
    ])
    expect(first?.state.senses).toEqual(['To move fast on foot.'])
    expect(world.llmCalls[0]?.system).toContain('"native": boolean, "learner": boolean')
    // Both slots are filled, so nothing is left to classify, and nothing went to the review queue.
    expect(openItems(world)).toEqual([])
    expect(world.queued).toEqual([])
    expect(await classifyWork(world.deps, 'trace-cron', 60_000)).toEqual({
      items: 0,
      decided: 0,
      chosen: 0,
      refused: 0,
    })
  })

  it('classifies a new entry once its inventory publishes, and never hands the item to an agent [spec: work/classify]', async () => {
    const { world } = await runWorld()
    expect(await claimWork(world.deps, agentA, { limit: 10, types: ['productive_use'] })).toBeNull()
    world.answerDecision('jev', jevScores({ verb: ACTIVE, noun: ACTIVE }))
    await classifyWork(world.deps, 'trace-cron', 60_000)

    const walk = await headword(world, 'walk', [{ pos: 'verb', gloss: 'To move on foot at a normal pace.' }])
    expect(openItems(world).map((item) => item.entryId)).toEqual([walk.entry.id])
    world.answerDecision('jev', jevScores({ verb: ACTIVE }))
    expect(await classifyWork(world.deps, 'trace-cron', 60_000)).toMatchObject({ items: 1, decided: 1 })
    expect(
      uses(world)
        .filter((fact) => fact.subjectId === walk.entry.id)
        .map((fact) => fact.payload),
    ).toEqual([{ pos: 'verb', native: true, learner: true }])
  })

  it('makes a word natives only understand passive for the learner too, and the LLM choice obeys it', async () => {
    const { world } = await runWorld()
    const archaic = { native_active: 0.1, native_passive: 0.9, learner_active: 0.95, learner_passive: 0.1 }
    world.answerDecision('jev', jevScores({ verb: archaic, noun: { ...archaic, native_passive: 0.6 } }))
    world.chooseLlm(() => ({ native: false, learner: true, confidence: 0.6, reason: 'Literary.' }))
    await classifyWork(world.deps, 'trace-cron', 60_000)
    expect(uses(world).map((fact) => fact.payload)).toEqual([
      { pos: 'verb', native: false, learner: false },
      { pos: 'noun', native: false, learner: false },
    ])
    // Natives' passive settles the learner's too: Jev decided the verb on its native score alone.
    expect(uses(world).map((fact) => [fact.review?.reviewer, fact.review?.confidence])).toEqual([
      ['jev', 0.9],
      ['jev+llm', 0.6],
    ])
  })

  it('records a refused write as the pass, so the item reaches a curator after its two passes', async () => {
    const { world, run } = await runWorld()
    world.answerDecision('jev', jevScores({ verb: ACTIVE, noun: ACTIVE }))
    const at = world.deps.clock.now().toISOString()
    world.facts.push({
      id: world.deps.ids.fact(),
      kind: 'productive_use',
      subjectId: run.entry.id,
      objectId: null,
      contentKey: 'verb|true|true',
      payload: { pos: 'verb', native: true, learner: true },
      status: 'rejected',
      supersedesId: null,
      author: 'agent:agent-a',
      review: null,
      createdAt: at,
      updatedAt: at,
    } as Fact)
    // The first pass publishes the noun and is refused the verb; the second is refused it again.
    expect(await classifyWork(world.deps, 'trace-cron', 60_000)).toEqual({
      items: 2,
      decided: 1,
      chosen: 0,
      refused: 2,
    })
    const [item] = openItems(world)
    expect([item?.gap, item?.attempts]).toEqual([{ type: 'productive_use', missing: ['verb'] }, 2])
    expect(item?.lastNote).toContain('verb: refused, Review already rejected this content')
    expect(world.tickets.map((ticket) => ticket.type)).toEqual(['stuck_work'])
    expect(await classifyWork(world.deps, 'trace-cron', 60_000)).toMatchObject({ items: 0 })
  })

  it('releases the lease and stops on a reviewer failure, leaving the item to a later run', async () => {
    const { world } = await runWorld()
    world.answerDecision('jev', () => {
      throw new ReviewerTransportError('Jev is down.')
    })
    await expect(classifyWork(world.deps, 'trace-cron', 60_000)).rejects.toBeInstanceOf(ReviewerTransportError)
    expect(openItems(world).map((item) => [item.attempts, item.lease])).toEqual([[0, null]])
    expect(uses(world)).toEqual([])

    world.answerDecision('jev', jevScores({ verb: { ...ACTIVE, native_active: 0.5 }, noun: ACTIVE }))
    world.chooseLlm(() => ({ native: 'yes' }))
    await expect(classifyWork(world.deps, 'trace-cron', 60_000)).rejects.toBeInstanceOf(ReviewerProtocolError)
  })

  it('skips a part of speech whose common senses are gone since the item opened, and fails loudly on anything unexpected', async () => {
    const { world } = await runWorld()
    world.answerDecision('jev', jevScores({ verb: ACTIVE, noun: ACTIVE }))
    const [item] = openItems(world)
    if (!item || item.gap.type !== 'productive_use') throw new Error('The entry has an open productive use.')
    item.gap = { type: 'productive_use', missing: ['adjective', 'verb'] }
    expect(await classifyWork(world.deps, 'trace-cron', 60_000)).toMatchObject({ decided: 2 })
    expect(world.decisionCalls.map((call) => call.state['part of speech'])).toEqual(['verb', 'noun'])

    const other = await headword(world, 'walk', [{ pos: 'verb', gloss: 'To move on foot.' }])
    expect(other.entry).toBeDefined()
    world.deps.facts.insert = async () => {
      throw new Error('The store is broken.')
    }
    await expect(classifyWork(world.deps, 'trace-cron', 60_000)).rejects.toThrow('The store is broken.')
  })

  it('classifies nothing once its budget is spent', async () => {
    const { world } = await runWorld()
    expect(await classifyWork(world.deps, 'trace-cron', 0)).toEqual({ items: 0, decided: 0, chosen: 0, refused: 0 })
    expect(openItems(world)).toHaveLength(1)
  })
})
