import type { Fact } from '@server/domain/fact'
import { admin, agentA } from '@server/testing/actors'
import { type FakeWorld, fakeWorld } from '@server/testing/fakes'
import { drainReviews, headword } from '@server/testing/seed'
import type { EntryId, FactId, SenseId, SentenceId, TopicId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { getFact, submitFact } from './facts'
import { ReviewerTransportError } from './ports'
import { reconcilePhraseLists, reconcileReviews, reviewFact } from './review'

const scores = (score: number, model: string) => (questions: Record<string, string>) => ({
  model,
  answers: Object.fromEntries(Object.keys(questions).map((key) => [key, score])),
})

async function bankWorld() {
  const world = fakeWorld()
  const bank = await headword(world, 'bank', [
    { pos: 'noun', gloss: 'land beside a river' },
    { pos: 'noun', gloss: 'a financial institution' },
  ])
  const [river, money] = bank.senses as [SenseId, SenseId]
  return { world, bank, river, money }
}

async function submitted(world: FakeWorld, input: Parameters<typeof submitFact>[2]) {
  const { fact } = await submitFact(world.deps, agentA, input)
  world.queued.length = 0
  world.decisionCalls.length = 0
  world.llmCalls.length = 0
  return fact
}

/** A pending fact written straight to the store, for states no submission reaches. */
function rawFact(world: FakeWorld, fact: Pick<Fact, 'kind' | 'subjectId' | 'payload'> & Partial<Fact>): Fact {
  const at = world.deps.clock.now().toISOString()
  const stored = {
    id: world.deps.ids.fact(),
    objectId: null,
    contentKey: `raw-${world.facts.length}`,
    status: 'pending',
    supersedesId: null,
    author: 'agent:agent-a',
    review: null,
    createdAt: at,
    updatedAt: at,
    ...fact,
  } as Fact
  world.facts.push(stored)
  return stored
}

describe('reviewFact', () => {
  it('publishes an inventory the decision model settles and records what was judged [spec: facts/review-publish]', async () => {
    const world = fakeWorld()
    const { inventory } = await headword(world, 'bank', [{ pos: 'noun', gloss: 'land beside a river' }])
    expect(inventory?.status).toBe('published')
    expect(world.decisionCalls).toEqual([
      { model: 'jev', questions: { sense_1: expect.any(String) }, state: { word: 'bank' } },
    ])
    expect(world.llmCalls).toEqual([])
    expect(inventory?.review).toMatchObject({
      reviewer: 'jev',
      model: 'jev-test',
      verdict: 'pass',
      confidence: 0.95,
      // The pending inventory under review is the entry's live one, so its senses are the subject's.
      context: {
        subject: { lemma: 'bank', senses: [{ pos: 'noun', gloss: 'land beside a river' }], caseVariants: [] },
        target: null,
        topic: null,
      },
      reviewed_at: '2026-01-01T00:00:00.000Z',
    })
  })

  it('asks the LLM once when the decision model does not settle, and its verdict is final [spec: facts/one-shot-review]', async () => {
    const world = fakeWorld()
    world.answerDecision('jev', scores(0.6, 'jev-test'))
    world.answerLlm(() => ({ model: 'llm-test', verdict: 'fail', confidence: 0.8, reason: 'Gloss is wrong.' }))
    const { inventory } = await headword(world, 'bank', [{ pos: 'noun', gloss: 'a kind of fish' }])
    expect(inventory?.status).toBe('rejected')
    expect(world.llmCalls).toHaveLength(1)
    expect(inventory?.review).toMatchObject({
      reviewer: 'jev+llm',
      model: 'jev-test+llm-test',
      verdict: 'fail',
      confidence: 0.8,
      reason: expect.stringContaining('Gloss is wrong.'),
      detail: {
        opinions: [
          { reviewer: 'jev', verdict: 'uncertain' },
          { reviewer: 'llm', verdict: 'fail', detail: { prompt: world.llmCalls[0] } },
        ],
      },
    })
  })

  it('publishes on an uncertain LLM verdict: only a fail rejects', async () => {
    const world = fakeWorld()
    world.answerDecision('jev', scores(0.2, 'jev-test'))
    world.answerLlm(() => ({ model: 'llm-test', verdict: 'uncertain', confidence: 0.5, reason: 'Not sure.' }))
    const { inventory } = await headword(world, 'bank', [{ pos: 'noun', gloss: 'land beside a river' }])
    expect(inventory).toMatchObject({ status: 'published', review: { reviewer: 'jev+llm', verdict: 'uncertain' } })
  })

  it('sends a kind no decision model judges to the LLM alone', async () => {
    const { world, river } = await bankWorld()
    const example = await submitted(world, {
      kind: 'example',
      subject_id: river,
      payload: { text: 'We sat on the bank.' },
    })
    await expect(reviewFact(world.deps, example.id, 'trace-review')).resolves.toBe('published')
    expect(world.decisionCalls).toEqual([])
    expect(world.llmCalls).toHaveLength(1)
    expect(world.llmCalls[0]?.user).toContain('land beside a river')
    expect((await getFact(world.deps, example.id)).review).toMatchObject({
      reviewer: 'llm',
      model: 'llm-test',
      detail: { prompt: world.llmCalls[0] },
      context: {
        subject: {
          lemma: 'bank',
          pos: 'noun',
          gloss: 'land beside a river',
          siblings: [{ pos: 'noun', gloss: 'a financial institution' }],
        },
      },
    })
  })

  it('settles a sense translation when either decision model reaches its threshold', async () => {
    const { world, river } = await bankWorld()
    world.answerDecision('jev', scores(0.3, 'jev-test'))
    const translation = await submitted(world, {
      kind: 'translation',
      subject_id: river,
      payload: { language: 'zh', of: 'sense', text: '河岸' },
    })
    await expect(reviewFact(world.deps, translation.id, 'trace-review')).resolves.toBe('published')
    expect(world.decisionCalls.map((call) => call.model)).toEqual(['jev', 'luna'])
    expect(world.llmCalls).toEqual([])
    expect((await getFact(world.deps, translation.id)).review).toMatchObject({
      reviewer: 'jev+luna',
      model: 'jev-test+luna-test',
      verdict: 'pass',
      confidence: 0.95,
      detail: {
        opinions: [
          { reviewer: 'jev', verdict: 'fail' },
          { reviewer: 'luna', verdict: 'pass' },
        ],
      },
    })
  })

  it('leaves a topic to the LLM when the models’ mean misses the mean threshold, with the topic in context', async () => {
    const { world, river } = await bankWorld()
    world.answerDecision('jev', scores(0.7, 'jev-test'))
    world.answerDecision('luna', scores(0.85, 'luna-test'))
    const tag = await submitted(world, {
      kind: 'topic',
      subject_id: river,
      payload: { topic_id: 'kitchen' as TopicId },
    })
    await expect(reviewFact(world.deps, tag.id, 'trace-review')).resolves.toBe('published')
    expect(world.llmCalls).toHaveLength(1)
    expect((await getFact(world.deps, tag.id)).review).toMatchObject({
      reviewer: 'jev+luna+llm',
      context: { topic: { category: 'Home', topic: 'In the kitchen' } },
    })
  })

  it('judges a relation with its target sense and the target entry’s other senses [spec: facts/relation-target-senses]', async () => {
    const { world, river } = await bankWorld()
    const shore = await headword(world, 'shore', [
      { pos: 'noun', gloss: 'land along the edge of water' },
      { pos: 'verb', gloss: 'to support with props' },
    ])
    const relation = await submitted(world, {
      kind: 'relation',
      subject_id: river,
      payload: { type: 'synonym', target_sense_id: shore.senses[0] as SenseId },
    })
    await expect(reviewFact(world.deps, relation.id, 'trace-review')).resolves.toBe('published')
    expect((await getFact(world.deps, relation.id)).review?.context).toMatchObject({
      target: {
        lemma: 'shore',
        gloss: 'land along the edge of water',
        siblings: [{ pos: 'verb', gloss: 'to support with props' }],
      },
    })
  })

  it('rejects a fact whose context leaves nothing to judge without asking a reviewer', async () => {
    const { world, bank, river, money } = await bankWorld()
    const example = await submitted(world, {
      kind: 'example',
      subject_id: river,
      payload: { text: 'We sat on the bank.' },
    })
    // A curator's correction drops the river sense, so the example's sense has no live gloss.
    await submitFact(world.deps, admin, {
      kind: 'senses',
      subject_id: bank.entry.id,
      supersedes_id: bank.inventory?.id,
      payload: { senses: [{ id: money, pos: 'noun', gloss: 'a financial institution', rank: 'common' }] },
    })
    world.llmCalls.length = 0
    await expect(reviewFact(world.deps, example.id, 'trace-review')).resolves.toBe('rejected')
    expect(world.llmCalls).toEqual([])
    expect((await getFact(world.deps, example.id)).review).toMatchObject({
      reviewer: 'llm',
      model: 'none',
      verdict: 'fail',
      confidence: 1,
      reason: 'The referenced sense has no live gloss.',
    })
  })

  it('reviews a fact about a pending fact without waiting for it [spec: facts/independent]', async () => {
    const { world, river } = await bankWorld()
    const example = await submitted(world, {
      kind: 'example',
      subject_id: river,
      payload: { text: 'We sat on the bank.' },
    })
    const translation = await submitted(world, {
      kind: 'translation',
      subject_id: example.objectId as string,
      payload: { language: 'zh', of: 'sentence', text: '我们坐在河岸上。' },
    })
    await expect(reviewFact(world.deps, translation.id, 'trace-review')).resolves.toBe('published')
    expect((await getFact(world.deps, example.id)).status).toBe('pending')
    expect((await getFact(world.deps, translation.id)).review?.context).toMatchObject({
      subject: {
        text: 'We sat on the bank.',
        sense: { gloss: 'land beside a river' },
        sayingOf: [],
        meaning: null,
      },
    })
    expect(world.llmCalls.at(-1)?.user).toContain('It is an example of "bank" (noun), meaning "land beside a river".')
  })

  it('skips a decided, unknown, or concurrently changed fact [spec: facts/review-idempotent]', async () => {
    const { world, bank, river } = await bankWorld()
    await expect(reviewFact(world.deps, bank.inventory?.id as FactId, 'trace-review')).resolves.toBe('skipped')
    await expect(reviewFact(world.deps, 'missing' as FactId, 'trace-review')).resolves.toBe('skipped')
    const example = await submitted(world, {
      kind: 'example',
      subject_id: river,
      payload: { text: 'We sat on the bank.' },
    })
    world.answerLlm(() => {
      const index = world.facts.findIndex((fact) => fact.id === example.id)
      world.facts[index] = { ...(world.facts[index] as Fact), status: 'retracted' }
      return { model: 'llm-test', verdict: 'pass', confidence: 0.9, reason: 'Fine.' }
    })
    await expect(reviewFact(world.deps, example.id, 'trace-review')).resolves.toBe('skipped')
    expect((await getFact(world.deps, example.id)).review).toBeNull()
  })

  it('propagates a reviewer transport failure and leaves the fact pending [spec: facts/transport-retry]', async () => {
    const world = fakeWorld()
    const { entry } = await headword(world, 'bank')
    world.answerDecision('jev', () => {
      throw new ReviewerTransportError('Jev is down.')
    })
    const { fact } = await submitFact(world.deps, agentA, {
      kind: 'senses',
      subject_id: entry.id,
      payload: { senses: [{ pos: 'noun', gloss: 'land beside a river', rank: 'common' }] },
    })
    await expect(reviewFact(world.deps, fact.id, 'trace-review')).rejects.toBeInstanceOf(ReviewerTransportError)
    expect((await getFact(world.deps, fact.id)).status).toBe('pending')
    world.answerLlm(() => {
      throw new ReviewerTransportError('The LLM is down.')
    })
    world.answerDecision('jev', scores(0.6, 'jev-test'))
    await expect(reviewFact(world.deps, fact.id, 'trace-review')).rejects.toBeInstanceOf(ReviewerTransportError)
    expect((await getFact(world.deps, fact.id)).status).toBe('pending')
  })

  it('retires the original when its correction publishes', async () => {
    const { world, river } = await bankWorld()
    const original = await submitted(world, {
      kind: 'example',
      subject_id: river,
      payload: { text: 'We sat on the bank.' },
    })
    await reviewFact(world.deps, original.id, 'trace-review')
    const correction = await submitted(world, {
      kind: 'example',
      subject_id: river,
      supersedes_id: original.id,
      payload: { text: 'We sat on the river bank.' },
    })
    await expect(reviewFact(world.deps, correction.id, 'trace-review')).resolves.toBe('published')
    expect((await getFact(world.deps, original.id)).status).toBe('superseded')
  })

  it('fails loudly on a fact whose nodes are gone', async () => {
    const { world, river } = await bankWorld()
    const orphanEntry = rawFact(world, {
      kind: 'syllables',
      subjectId: 'gone-entry' as EntryId,
      payload: { syllables: ['x'] },
    })
    await expect(reviewFact(world.deps, orphanEntry.id, 't')).rejects.toThrow('does not exist')
    const orphanSense = rawFact(world, {
      kind: 'example',
      subjectId: 'gone-sense' as SenseId,
      payload: { sentence_id: 'gone-sentence' as SentenceId },
    })
    await expect(reviewFact(world.deps, orphanSense.id, 't')).rejects.toThrow('does not exist')
    const notTranslatable = rawFact(world, {
      kind: 'translation',
      subjectId: river as unknown as FactId,
      payload: { language: 'zh', of: 'collocation', text: '岸' },
    })
    await expect(reviewFact(world.deps, notTranslatable.id, 't')).rejects.toThrow('is not a collocation')
    const orphanSentence = rawFact(world, {
      kind: 'sentence_meaning',
      subjectId: 'gone-sentence' as SentenceId,
      payload: { gloss: 'Gone.' },
    })
    await expect(reviewFact(world.deps, orphanSentence.id, 't')).rejects.toThrow('does not exist')
  })

  it('reads a topic id that names a category as no topic, and fails on a leaf whose category is gone', async () => {
    const { world, river } = await bankWorld()
    const category = rawFact(world, { kind: 'topic', subjectId: river, payload: { topic_id: 'home' as TopicId } })
    await expect(reviewFact(world.deps, category.id, 't')).resolves.toBe('rejected')
    expect((await getFact(world.deps, category.id)).review?.reason).toBe(
      'The referenced topic is not a leaf topic of the taxonomy.',
    )
    world.topics.splice(
      world.topics.findIndex((node) => node.id === 'home'),
      1,
    )
    const orphan = rawFact(world, { kind: 'topic', subjectId: river, payload: { topic_id: 'kitchen' as TopicId } })
    await expect(reviewFact(world.deps, orphan.id, 't')).rejects.toThrow('which does not exist')
  })
})

describe('a published phrases list', () => {
  const admission = (world: FakeWorld, lemma: string) => {
    const entry = world.entries.find((candidate) => candidate.lemma === lemma)
    return entry && world.work.get(entry.id)
  }
  const idOf = (world: FakeWorld, lemma: string) =>
    world.entries.find((candidate) => candidate.lemma === lemma)?.id as EntryId

  it('admits its entry items as live entries of its headword’s batch, and lets dropped ones go [spec: facts/phrases-admit]', async () => {
    const world = fakeWorld()
    const give = await headword(world, 'give', [{ pos: 'verb', gloss: 'to hand something to someone' }])
    const { fact: list } = await submitFact(world.deps, agentA, {
      kind: 'phrases',
      subject_id: give.entry.id,
      payload: {
        phrases: [
          { type: 'phrasal_verb', text: 'give up' },
          { type: 'phrasal_verb', text: 'give in' },
          { type: 'saying', text: 'Give and take.' },
        ],
      },
    })
    expect(admission(world, 'give up')).toMatchObject({ live: false })
    await drainReviews(world)
    expect((await getFact(world.deps, list.id)).status).toBe('published')
    expect(admission(world, 'give up')).toMatchObject({ live: true, batch: 1 })
    expect(admission(world, 'give in')).toMatchObject({ live: true, batch: 1 })
    // A saying admits nothing: it is a sentence.
    expect(admission(world, 'Give and take.')).toBeUndefined()
    // Jev was asked about each item by its type and text.
    expect(world.decisionCalls.at(-1)?.questions.phrase_3).toContain('"Give and take." an established English saying')

    const up = await headword(world, 'up', [{ pos: 'adverb', gloss: 'towards a higher place' }])
    await submitFact(world.deps, agentA, {
      kind: 'phrases',
      subject_id: up.entry.id,
      payload: { phrases: [{ type: 'phrasal_verb', entry_id: idOf(world, 'give up') }] },
    })
    await drainReviews(world)

    await submitFact(world.deps, admin, {
      kind: 'phrases',
      subject_id: give.entry.id,
      supersedes_id: list.id,
      payload: { phrases: [{ type: 'phrasal_verb', text: 'give out' }] },
    })
    await drainReviews(world)
    expect((await getFact(world.deps, list.id)).status).toBe('superseded')
    expect(admission(world, 'give out')).toMatchObject({ live: true })
    expect(admission(world, 'give in')).toMatchObject({ live: false })
    // Another published list still names it.
    expect(admission(world, 'give up')).toMatchObject({ live: true })
  })

  it('admits phrases of a headword outside any batch in batch 0', async () => {
    const world = fakeWorld()
    const take = await world.deps.nodes.insertEntry({
      id: world.deps.ids.entry(),
      lemma: 'take' as never,
      createdBy: 'admin:admin-1' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const [off, over] = await world.deps.nodes.ensureEntries(
      ['take off', 'take over'] as never,
      'admin:admin-1' as never,
      '2026-01-01T00:00:00.000Z',
    )
    const original = rawFact(world, {
      kind: 'phrases',
      subjectId: take.id,
      status: 'published',
      payload: { phrases: [{ type: 'phrasal_verb', entry_id: off?.id as EntryId }] },
    })
    const correction = rawFact(world, {
      kind: 'phrases',
      subjectId: take.id,
      supersedesId: original.id,
      payload: { phrases: [{ type: 'phrasal_verb', entry_id: over?.id as EntryId }] },
    })
    await expect(reviewFact(world.deps, correction.id, 't')).resolves.toBe('published')
    expect(admission(world, 'take over')).toMatchObject({ live: true, batch: 0 })
    expect(admission(world, 'take off')).toMatchObject({ live: false })
  })

  it('finishes the admission of a published list that names phrases with no live entry [spec: facts/phrases-admit]', async () => {
    const world = fakeWorld()
    const give = await headword(world, 'give', [{ pos: 'verb', gloss: 'to hand something to someone' }])
    const [up, inn] = await world.deps.nodes.ensureEntries(
      ['give up', 'give in'] as never,
      'agent:agent-a' as never,
      '2026-01-01T00:00:00.000Z',
    )
    // Published, but its admission never ran: the list's status was written before it failed.
    rawFact(world, {
      kind: 'phrases',
      subjectId: give.entry.id,
      status: 'published',
      payload: {
        phrases: [
          { type: 'phrasal_verb', entry_id: up?.id as EntryId },
          { type: 'phrasal_verb', entry_id: inn?.id as EntryId },
        ],
      },
    })
    expect(admission(world, 'give up')).toMatchObject({ live: false })

    await expect(reconcilePhraseLists(world.deps)).resolves.toBe(1)
    expect(admission(world, 'give up')).toMatchObject({ live: true, batch: 1 })
    expect(admission(world, 'give in')).toMatchObject({ live: true, batch: 1 })
    expect(await world.deps.work.countStale()).toBe(0)
    await expect(reconcilePhraseLists(world.deps)).resolves.toBe(0)
  })

  it('reviews a sentence translation and meaning with where the sentence is used [spec: facts/sentence-meaning]', async () => {
    const world = fakeWorld()
    const give = await headword(world, 'give', [{ pos: 'verb', gloss: 'to hand something to someone' }])
    await submitFact(world.deps, agentA, {
      kind: 'phrases',
      subject_id: give.entry.id,
      payload: { phrases: [{ type: 'saying', text: 'Give and take.' }] },
    })
    await drainReviews(world)
    const sentence = world.sentences[0]?.id as SentenceId
    const meaning = await submitted(world, {
      kind: 'sentence_meaning',
      subject_id: sentence,
      payload: { gloss: 'Each side should give something.' },
    })
    world.answerDecision('jev', scores(0.2, 'jev-test'))
    await expect(reviewFact(world.deps, meaning.id, 't')).resolves.toBe('published')
    expect(world.llmCalls.at(-1)?.user).toContain('the right dictionary gloss of the English saying "Give and take."')
    const translation = await submitted(world, {
      kind: 'translation',
      subject_id: sentence,
      payload: { language: 'zh', of: 'sentence', text: '有来有往。' },
    })
    await expect(reviewFact(world.deps, translation.id, 't')).resolves.toBe('published')
    expect((await getFact(world.deps, translation.id)).review?.context).toMatchObject({
      subject: { text: 'Give and take.', sense: null, sayingOf: ['give'], meaning: 'Each side should give something.' },
    })
  })
})

describe('reconcileReviews', () => {
  it('re-enqueues facts pending for more than an hour with the trace [spec: facts/reconcile]', async () => {
    const { world, river } = await bankWorld()
    const fact = await submitted(world, {
      kind: 'example',
      subject_id: river,
      payload: { text: 'We sat on the bank.' },
    })
    await expect(reconcileReviews(world.deps, 'trace-cron')).resolves.toBe(0)
    expect(world.queued).toEqual([])
    world.setNow('2026-01-01T00:59:59.000Z')
    await expect(reconcileReviews(world.deps, 'trace-cron')).resolves.toBe(0)
    world.setNow('2026-01-01T01:00:01.000Z')
    await expect(reconcileReviews(world.deps, 'trace-cron')).resolves.toBe(1)
    expect(world.queued).toEqual([{ factId: fact.id, traceId: 'trace-cron' }])
  })

  it('re-enqueues a fact still waiting in a backlog once per hour, not on every run [spec: facts/reconcile]', async () => {
    const { world, river } = await bankWorld()
    const fact = await submitted(world, {
      kind: 'example',
      subject_id: river,
      payload: { text: 'We sat on the bank.' },
    })
    world.setNow('2026-01-01T01:00:01.000Z')
    await expect(reconcileReviews(world.deps, 'trace-1')).resolves.toBe(1)
    world.setNow('2026-01-01T01:05:00.000Z')
    await expect(reconcileReviews(world.deps, 'trace-2')).resolves.toBe(0)
    world.setNow('2026-01-01T02:00:00.000Z')
    await expect(reconcileReviews(world.deps, 'trace-3')).resolves.toBe(0)
    world.setNow('2026-01-01T02:00:02.000Z')
    await expect(reconcileReviews(world.deps, 'trace-4')).resolves.toBe(1)
    expect(world.queued).toEqual([
      { factId: fact.id, traceId: 'trace-1' },
      { factId: fact.id, traceId: 'trace-4' },
    ])
  })
})
