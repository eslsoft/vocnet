import type { Fact, FactOf } from '@server/domain/fact'
import type { Lemma } from '@server/domain/term'
import { admin, agentA, agentB, curatorAgent } from '@server/testing/actors'
import { type FakeWorld, fakeWorld } from '@server/testing/fakes'
import { drainReviews, headword } from '@server/testing/seed'
import type { EntryId, FactId, FactPayloads, SenseId, SentenceId, SubmitFactInput, TopicId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { getFact, getFactWithEntry, listFacts, rereviewFact, retractFact, submitFact } from './facts'
import { reviewFact } from './review'

async function bankWorld() {
  const world = fakeWorld()
  const bank = await headword(world, 'bank', [
    { pos: 'noun', gloss: 'land beside a river' },
    { pos: 'noun', gloss: 'a financial institution' },
  ])
  const [river, money] = bank.senses as [SenseId, SenseId]
  const shore = await headword(world, 'shore', [{ pos: 'noun', gloss: 'land along water' }])
  world.queued.length = 0
  world.llmCalls.length = 0
  world.decisionCalls.length = 0
  return { world, entry: bank.entry, river, money, shore: shore.senses[0] as SenseId, shoreEntry: shore.entry }
}

const submit = (world: FakeWorld, input: SubmitFactInput, actor = agentA) => submitFact(world.deps, actor, input)
const example = (subject: string, text: string, supersedes_id?: FactId): SubmitFactInput => ({
  kind: 'example',
  subject_id: subject,
  payload: { text },
  ...(supersedes_id ? { supersedes_id } : {}),
})
const relation = (from: SenseId, type: 'synonym' | 'hypernym' | 'antonym', to: SenseId): SubmitFactInput => ({
  kind: 'relation',
  subject_id: from,
  payload: { type, target_sense_id: to },
})

/** Submits and reviews the fact; the reviewers decide as the world is set to. */
async function decided(world: FakeWorld, input: SubmitFactInput, actor = agentA): Promise<Fact> {
  const { fact } = await submit(world, input, actor)
  world.queued.length = 0
  await reviewFact(world.deps, fact.id, 'trace-review')
  return getFact(world.deps, fact.id)
}

async function rejected(world: FakeWorld, input: SubmitFactInput): Promise<Fact> {
  world.failReviews()
  const fact = await decided(world, input)
  world.passReviews()
  expect(fact.status).toBe('rejected')
  return fact
}

/** Runs `interleave` once, right after the first read of `id`, as a write racing that read. */
function interleaveAfterRead(world: FakeWorld, id: FactId, interleave: () => Promise<unknown>) {
  const { find } = world.deps.facts
  let pending = true
  world.deps.facts.find = async (read) => {
    const found = await find(read)
    if (read === id && pending) {
      pending = false
      await interleave()
    }
    return found
  }
}

const setStatus = (world: FakeWorld, id: FactId, status: Fact['status']) => {
  const index = world.facts.findIndex((fact) => fact.id === id)
  world.facts[index] = { ...world.facts[index], status } as Fact
}

describe('submitFact', () => {
  it('stores a pending fact authored by the actor and enqueues its review', async () => {
    const { world, river } = await bankWorld()
    const { fact, created } = await submit(world, example(river, 'We sat on the bank.'), agentB)
    expect(created).toBe(true)
    const [sentence] = world.sentences
    expect(sentence).toMatchObject({ text: 'We sat on the bank.', source: null, createdBy: 'agent:agent-b' })
    expect(fact).toMatchObject({
      status: 'pending',
      author: 'agent:agent-b',
      review: null,
      objectId: sentence?.id,
      payload: { sentence_id: sentence?.id },
      contentKey: sentence?.id,
    })
    expect(world.queued).toEqual([{ factId: fact.id, traceId: 'trace-b' }])
  })

  it('finds a sentence by its text or creates it, so senses share one sentence [spec: facts/sentence-resolve]', async () => {
    const { world, river, money, shore } = await bankWorld()
    const { fact: first } = await submit(world, example(river, 'We sat on the bank.'))
    const { fact: shared } = await submit(world, example(shore, '  we sat on the BANK. '))
    expect(world.sentences).toHaveLength(1)
    expect(shared.payload).toEqual(first.payload)
    const sentenceId = world.sentences[0]?.id as SentenceId
    const { fact: byId } = await submit(world, {
      kind: 'example',
      subject_id: money,
      payload: { sentence_id: sentenceId },
    })
    expect(byId.objectId).toBe(sentenceId)
    await expect(
      submit(world, {
        kind: 'example',
        subject_id: money,
        payload: { sentence_id: crypto.randomUUID() as SentenceId },
      }),
    ).rejects.toMatchObject({ code: 'invalid_reference', message: expect.stringContaining('does not exist') })
    // A sentence is created only for a submission about a real subject.
    await expect(submit(world, example(crypto.randomUUID(), 'A new sentence.'))).rejects.toMatchObject({
      code: 'invalid_reference',
    })
    expect(world.sentences).toHaveLength(1)
  })

  it('names phrase entries and sayings by text, creating missing ones only once the list fits [spec: facts/phrases-resolve]', async () => {
    const { world, entry, river } = await bankWorld()
    const list = (phrases: unknown[]) =>
      submit(world, { kind: 'phrases', subject_id: entry.id, payload: { phrases } } as SubmitFactInput)
    await expect(list([{ type: 'idiom', text: 'make up' }])).rejects.toMatchObject({ code: 'invalid_reference' })
    await expect(
      list([{ type: 'compound', text: 'bank account', sense_id: crypto.randomUUID() }]),
    ).rejects.toMatchObject({
      code: 'invalid_reference',
      message: expect.stringContaining('is not a sense of the current inventory'),
    })
    expect(world.entries.map((one) => one.lemma)).not.toContain('make up')
    expect(world.entries.map((one) => one.lemma)).not.toContain('bank account')
    const { fact } = await list([
      { type: 'compound', text: 'bank account', sense_id: river },
      { type: 'idiom', text: 'break the bank' },
      { type: 'saying', text: 'Never bank on luck.' },
    ])
    const account = world.entries.find((one) => one.lemma === 'bank account')
    const broken = world.entries.find((one) => one.lemma === 'break the bank')
    const saying = world.sentences.find((one) => one.text === 'Never bank on luck.')
    expect(fact.payload).toEqual({
      phrases: [
        { type: 'compound', entry_id: account?.id, sense_id: river },
        { type: 'idiom', entry_id: broken?.id },
        { type: 'saying', sentence_id: saying?.id },
      ],
    })
    // Created entries are not live until the list publishes.
    expect(world.work.get(account?.id as EntryId)?.live).toBe(false)
    // The same list named by ids is the same live fact.
    await expect(
      submit(world, {
        kind: 'phrases',
        subject_id: entry.id,
        payload: { phrases: [...(fact.payload as FactPayloads['phrases']).phrases].reverse() },
      } as SubmitFactInput),
    ).resolves.toMatchObject({ created: false, fact: { id: fact.id } })
    await expect(list([{ type: 'idiom', entry_id: crypto.randomUUID() }])).rejects.toMatchObject({
      code: 'invalid_reference',
      message: expect.stringContaining('does not exist'),
    })
    await expect(
      list([
        { type: 'idiom', text: 'break the bank' },
        { type: 'phrasal_verb', entry_id: broken?.id },
      ]),
    ).rejects.toMatchObject({ code: 'invalid_reference', message: expect.stringContaining('names each phrase once') })
  })

  it('returns the live fact instead of a duplicate and enqueues nothing [spec: facts/dedupe]', async () => {
    const { world, river } = await bankWorld()
    const first = await submit(world, example(river, 'We sat on the bank.'))
    const again = await submit(world, example(river, ' we sat on the BANK. '), agentB)
    expect(again).toEqual({ fact: first.fact, created: false })
    expect(world.queued).toHaveLength(1)
  })

  it('refuses content review already rejected, naming the rejection [spec: facts/rejected-before]', async () => {
    const { world, river } = await bankWorld()
    const failed = await rejected(world, example(river, 'I robbed a bank.'))
    await expect(submit(world, example(river, 'I robbed a bank.'))).rejects.toMatchObject({
      code: 'rejected_before',
      status: 409,
      message: expect.stringContaining(`(${failed.id}): Wrong.`),
    })
    world.facts[world.facts.findIndex((fact) => fact.id === failed.id)] = { ...failed, review: null }
    await expect(submit(world, example(river, 'I robbed a bank.'))).rejects.toMatchObject({
      message: expect.stringContaining('no reason recorded'),
    })
    await expect(submit(world, example(river, 'I robbed a bank.'), curatorAgent)).resolves.toMatchObject({
      created: true,
    })
  })

  it("rejects a subject that is not the kind's subject type [spec: facts/subject-validation]", async () => {
    const { world, entry, river } = await bankWorld()
    await expect(submit(world, example(entry.id, 'x'))).rejects.toMatchObject({
      code: 'invalid_reference',
      message: `A example fact is about a sense; ${entry.id} is not one.`,
    })
    await expect(
      submit(world, { kind: 'form', subject_id: river, payload: { form: 'banks', type: 'plural' } }),
    ).rejects.toMatchObject({ code: 'invalid_reference' })
    await expect(
      submit(world, {
        kind: 'translation',
        subject_id: river,
        payload: { language: 'zh', of: 'sentence', text: '银行' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_reference' })
  })

  it('takes a translation of a sentence about the sentence, and of a collocation about that fact [spec: facts/translation-of]', async () => {
    const { world, river } = await bankWorld()
    const { fact: example_ } = await submit(world, example(river, 'We sat on the bank.'))
    const sentenceId = example_.objectId as string
    const translate = (subject: string, of: 'sense' | 'sentence' | 'collocation') =>
      submit(world, {
        kind: 'translation',
        subject_id: subject,
        payload: { language: 'zh', of, text: '我们坐在河岸上。' },
      })
    await expect(translate(sentenceId, 'sentence')).resolves.toMatchObject({
      created: true,
      fact: { subjectId: sentenceId },
    })
    await expect(translate(sentenceId, 'sense')).rejects.toMatchObject({ code: 'invalid_reference' })
    await expect(translate(example_.id, 'sentence')).rejects.toMatchObject({
      code: 'invalid_reference',
      message: `A translation fact is about a sentence; ${example_.id} is not one.`,
    })
    await expect(translate(example_.id, 'collocation')).rejects.toMatchObject({ code: 'invalid_reference' })
    const { fact: collocation } = await submit(world, {
      kind: 'collocation',
      subject_id: river,
      payload: { text: 'river bank', pattern: 'noun_noun' },
    })
    await expect(translate(collocation.id, 'collocation')).resolves.toMatchObject({ created: true })
    world.senses.splice(
      world.senses.findIndex((sense) => sense.id === river),
      1,
    )
    await expect(translate(collocation.id, 'collocation')).rejects.toThrow('which does not exist')
  })

  it('takes a sentence meaning about a sentence [spec: facts/sentence-meaning]', async () => {
    const { world, river } = await bankWorld()
    const { fact: example_ } = await submit(world, example(river, 'We sat on the bank.'))
    const meaning = (subject: string) =>
      submit(world, { kind: 'sentence_meaning', subject_id: subject, payload: { gloss: 'We rested by the river.' } })
    await expect(meaning(example_.objectId as string)).resolves.toMatchObject({ created: true })
    await expect(meaning(river)).rejects.toMatchObject({ code: 'invalid_reference' })
  })

  it('rejects a relation whose target sense does not exist', async () => {
    const { world, river } = await bankWorld()
    await expect(submit(world, relation(river, 'synonym', crypto.randomUUID() as SenseId))).rejects.toMatchObject({
      code: 'invalid_reference',
      message: expect.stringContaining('Target sense'),
    })
  })

  it('records the target sense as the object of a relation', async () => {
    const { world, river, shore } = await bankWorld()
    const { fact } = await submit(world, relation(shore, 'hypernym', river))
    expect(fact).toMatchObject({ subjectId: shore, objectId: river })
  })

  it('stores a symmetric relation once, whichever sense it is submitted from [spec: facts/symmetric-relation-once]', async () => {
    const { world, river, shore } = await bankWorld()
    const [low, high] = [river, shore].sort() as [SenseId, SenseId]
    const first = await submit(world, relation(high, 'synonym', low))
    expect(first.fact).toMatchObject({ subjectId: low, objectId: high, payload: { target_sense_id: high } })
    await expect(submit(world, relation(low, 'synonym', high))).resolves.toEqual({ fact: first.fact, created: false })
    expect(world.queued).toHaveLength(1)
  })

  it('refuses a second relation type to the same entry and a hypernym cycle', async () => {
    const { world, river, money, shore } = await bankWorld()
    const synonym = await submit(world, relation(river, 'synonym', shore))
    await expect(submit(world, relation(shore, 'hypernym', money))).rejects.toMatchObject({
      code: 'invalid_reference',
      message: expect.stringContaining(`live synonym relation (${synonym.fact.id})`),
    })
    await expect(submit(world, relation(money, 'hypernym', shore))).resolves.toMatchObject({ created: true })
    await retractFact(world.deps, agentA, synonym.fact.id)
    await expect(submit(world, relation(shore, 'hypernym', river))).rejects.toMatchObject({
      message: expect.stringContaining('two entries cannot each be a kind of the other'),
    })
  })

  it('rejects a relation between two senses of one entry [spec: facts/relation-across-entries]', async () => {
    const { world, river, money } = await bankWorld()
    for (const target of [money, river]) {
      await expect(submit(world, relation(river, 'antonym', target))).rejects.toMatchObject({
        code: 'invalid_reference',
        message: expect.stringContaining('two different entries'),
      })
    }
    expect(world.queued).toHaveLength(0)
  })

  it('links only senses a published inventory of a live entry lists [spec: facts/relation-target-senses] [spec: facts/relation-shown-ends]', async () => {
    const { world, river, shoreEntry } = await bankWorld()
    const shown = { code: 'invalid_reference', message: expect.stringContaining('name the word in blocked_on') }
    // A pending inventory names senses that cannot show yet.
    const coast = await headword(world, 'coast')
    const { fact: draft } = await submit(world, {
      kind: 'senses',
      subject_id: coast.entry.id,
      payload: { senses: [{ pos: 'noun', gloss: 'land beside the sea', rank: 'common' }] },
    })
    const pendingSense = (draft as FactOf<'senses'>).payload.senses[0]!.id
    await expect(submit(world, relation(river, 'synonym', pendingSense))).rejects.toMatchObject(shown)
    await expect(submit(world, example(pendingSense, 'The coast was rocky.'))).rejects.toMatchObject(shown)
    // A sense of an entry that is not live never shows either.
    const shore = world.work.get(shoreEntry.id)!
    shore.live = false
    const shoreSense = world.senses.find((sense) => sense.entryId === shoreEntry.id)!
    await expect(submit(world, relation(river, 'hypernym', shoreSense.id))).rejects.toMatchObject(shown)
  })

  it('refuses a relation to a rare or dated sense [spec: facts/relation-ends]', async () => {
    const { world, river } = await bankWorld()
    const sewer = await headword(world, 'sewer', [
      { pos: 'noun', gloss: 'an underground drain', rank: 'common', register: 'dated' },
      { pos: 'noun', gloss: 'one who sews', rank: 'extra' },
    ])
    const [dated, rare] = sewer.senses as [SenseId, SenseId]
    await expect(submit(world, relation(river, 'hypernym', dated))).rejects.toMatchObject({
      code: 'invalid_reference',
      message: `Sense ${dated} is labelled dated; a relation links only current senses. Relate a current sense of the word instead.`,
    })
    await expect(submit(world, relation(river, 'hypernym', rare))).rejects.toMatchObject({
      message: expect.stringContaining("is in the extra senses of its entry's sense list"),
    })
  })

  it('refuses a synonym between spellings of one word, and holds each broader term in one layer [spec: facts/relation-padding-usecase]', async () => {
    const world = fakeWorld()
    const practise = await headword(world, 'practise', [{ pos: 'verb', gloss: 'to do something repeatedly' }])
    const practice = await headword(world, 'practice', [{ pos: 'verb', gloss: 'to do something often' }])
    await submit(world, { kind: 'form', subject_id: practise.entry.id, payload: { form: 'practice', type: 'variant' } })
    const [a, b] = [practise.senses[0]!, practice.senses[0]!]
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      await expect(submit(world, relation(from, 'synonym', to))).rejects.toMatchObject({
        code: 'invalid_reference',
        message: expect.stringContaining('are spellings of one word'),
      })
    }
    const dog = await headword(world, 'dog', [{ pos: 'noun', gloss: 'an animal kept as a pet' }])
    const canine = await headword(world, 'canine', [{ pos: 'noun', gloss: 'a dog or related animal' }])
    const biology = { type: 'hypernym', target_sense_id: canine.senses[0]!, domain: 'biology' } as const
    await expect(
      submit(world, { kind: 'relation', subject_id: dog.senses[0]!, payload: biology }),
    ).resolves.toMatchObject({ created: true, fact: { contentKey: `hypernym|${canine.senses[0]}|biology` } })
    await expect(submit(world, relation(dog.senses[0]!, 'hypernym', canine.senses[0]!))).rejects.toMatchObject({
      code: 'invalid_reference',
      message: expect.stringContaining('already has a live biology hypernym'),
    })
  })

  it('accepts a correction only of a published fact of the same kind and subject [spec: facts/supersede-rules]', async () => {
    const { world, river, money } = await bankWorld()
    const original = await decided(world, example(river, 'We sat on the bank.'))
    await expect(submit(world, example(river, 'x', crypto.randomUUID() as FactId))).rejects.toMatchObject({
      code: 'invalid_reference',
      message: expect.stringContaining('does not exist'),
    })
    await expect(submit(world, example(money, 'x', original.id))).rejects.toMatchObject({
      code: 'invalid_reference',
      message: 'A correction must have the same kind and subject as the fact it supersedes.',
    })
    const { fact: pending } = await submit(world, example(river, 'The bank was steep.'))
    await expect(submit(world, example(river, 'y', pending.id))).rejects.toMatchObject({
      code: 'conflict',
      message: 'Only a published fact can be superseded; it is pending.',
    })
    const { fact, created } = await submit(world, example(river, 'We sat on the grassy bank.', original.id))
    expect(created).toBe(true)
    expect(fact.supersedesId).toBe(original.id)
  })

  it('keeps one-valued kinds to one live fact per subject', async () => {
    const { world, river } = await bankWorld()
    const grammar = (countability: 'countable' | 'uncountable', supersedes_id?: FactId): SubmitFactInput => ({
      kind: 'grammar',
      subject_id: river,
      payload: { countability },
      ...(supersedes_id ? { supersedes_id } : {}),
    })
    const first = await decided(world, grammar('countable'))
    await expect(submit(world, grammar('uncountable'))).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining('submit one correction that supersedes the published one'),
    })
    await submit(world, grammar('uncountable', first.id))
    await expect(
      submit(world, {
        kind: 'grammar',
        subject_id: river,
        payload: { countability: 'countable', prepositions: ['of'] },
        supersedes_id: first.id,
      } as SubmitFactInput),
    ).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('already has a live correction') })
  })

  it('refuses a correction whose original leaves published after its check [spec: facts/correction-needs-published]', async () => {
    const { world, river } = await bankWorld()
    const original = await decided(world, example(river, 'We sat on the bank.'))
    interleaveAfterRead(world, original.id, () => retractFact(world.deps, agentA, original.id))
    await expect(submit(world, example(river, 'We sat on the grassy bank.', original.id))).rejects.toMatchObject({
      code: 'conflict',
      message: 'Only a published fact can be superseded; it is retracted.',
    })
    expect(world.facts.filter((fact) => fact.supersedesId === original.id)).toEqual([])
  })

  it('refuses a second live correction of one original [spec: facts/one-live-correction]', async () => {
    const { world, river } = await bankWorld()
    const corrected = { code: 'conflict', message: expect.stringContaining('already has a live correction') }
    const original = await decided(world, example(river, 'We sat on the bank.'))
    const first = await rejected(world, example(river, 'We sat on the river bank.', original.id))
    await submit(world, example(river, 'We sat on the grassy bank.', original.id))
    await expect(submit(world, example(river, 'We sat on the steep bank.', original.id))).rejects.toMatchObject(
      corrected,
    )
    await expect(rereviewFact(world.deps, admin, first.id)).rejects.toMatchObject(corrected)
  })

  it('publishes a correction in place of its original [spec: facts/correction]', async () => {
    const { world, river } = await bankWorld()
    const original = await decided(world, example(river, 'We sat on the bank.'))
    const correction = await decided(world, example(river, 'We sat on the grassy bank.', original.id))
    expect(correction.status).toBe('published')
    expect((await getFact(world.deps, original.id)).status).toBe('superseded')
  })

  it('reviews each fact on its own, whatever else is pending [spec: facts/independent]', async () => {
    const { world, river } = await bankWorld()
    const { fact: grammar } = await submit(world, {
      kind: 'grammar',
      subject_id: river,
      payload: { countability: 'countable' },
    })
    const sentence = await decided(world, example(river, 'We sat on the bank.'))
    expect(sentence.status).toBe('published')
    expect((await getFact(world.deps, grammar.id)).status).toBe('pending')
  })
})

describe('submitting a sense inventory', () => {
  const inventory = (entryId: EntryId, senses: object[], supersedes_id?: FactId): SubmitFactInput =>
    ({
      kind: 'senses',
      subject_id: entryId,
      payload: { senses },
      ...(supersedes_id ? { supersedes_id } : {}),
    }) as SubmitFactInput

  it('gives every new sense a sense row and keeps the ids it names [spec: facts/inventory-assigns-ids]', async () => {
    const world = fakeWorld()
    const { entry } = await headword(world, 'run')
    const { fact } = await submit(
      world,
      inventory(entry.id, [
        { pos: 'verb', gloss: 'to move fast on foot', rank: 'common' },
        { pos: 'noun', gloss: 'an act of running', rank: 'extra' },
      ]),
    )
    const senses = (fact as FactOf<'senses'>).payload.senses
    expect(senses.map((sense) => world.senses.find((row) => row.id === sense.id)?.pos)).toEqual(['verb', 'noun'])
    expect(world.senses.every((sense) => sense.entryId === entry.id && sense.createdBy === 'agent:agent-a')).toBe(true)
    world.failReviews()
    await drainReviews(world)
    world.passReviews()
    // A resubmission after a rejection reuses the row of each sense with the same meaning.
    const { fact: next } = await submit(
      world,
      inventory(entry.id, [
        { pos: 'verb', gloss: 'to move fast on foot', rank: 'common' },
        { pos: 'noun', gloss: 'An act of running', rank: 'common' },
      ]),
    )
    expect((next as FactOf<'senses'>).payload.senses.map((sense) => sense.id)).toEqual(senses.map((sense) => sense.id))
    expect(world.senses).toHaveLength(2)
    // With no live inventory left, a resubmission may still name the entry's senses by id.
    world.failReviews()
    await drainReviews(world)
    const { fact: byId } = await submit(
      world,
      inventory(entry.id, [
        { id: senses[0]?.id, pos: 'verb', gloss: 'to move fast on foot', rank: 'common' },
        { id: senses[1]?.id, pos: 'noun', gloss: 'a run: an act of running', rank: 'extra' },
      ]),
    )
    expect(byId.status).toBe('pending')
  })

  it('keeps only senses of the entry', async () => {
    const { world, entry, shore } = await bankWorld()
    await expect(
      submit(
        world,
        inventory(entry.id, [{ id: shore, pos: 'noun', gloss: 'land along water', rank: 'common' }]),
        curatorAgent,
      ),
    ).rejects.toMatchObject({
      code: 'invalid_reference',
      message: expect.stringContaining('keeps only senses of this entry'),
    })
  })

  it('fails loudly when no sense row comes back for a new sense', async () => {
    const world = fakeWorld()
    const { entry } = await headword(world, 'run')
    world.deps.nodes.insertSenses = async () => []
    await expect(
      submit(world, inventory(entry.id, [{ pos: 'verb', gloss: 'to move fast', rank: 'common' }])),
    ).rejects.toThrow('No sense row was stored')
  })

  it('fixes the senses once the inventory publishes, except for a curator [spec: facts/inventory-settled]', async () => {
    const { world, entry, river, money } = await bankWorld()
    const published = world.facts.find((fact) => fact.kind === 'senses' && fact.subjectId === entry.id)!
    const next = [
      { id: river, pos: 'noun', gloss: 'land beside a river', rank: 'common' },
      { id: money, pos: 'noun', gloss: 'a financial institution', rank: 'common' },
      { pos: 'verb', gloss: 'to keep money in a bank', rank: 'common' },
    ]
    await expect(submit(world, inventory(entry.id, next, published.id))).rejects.toMatchObject({
      code: 'inventory_settled',
      status: 403,
    })
    const corrected = await submit(world, inventory(entry.id, next, published.id), curatorAgent)
    expect(corrected).toMatchObject({ created: true, fact: { supersedesId: published.id, status: 'pending' } })
    expect((corrected.fact as FactOf<'senses'>).payload.senses.slice(0, 2).map((sense) => sense.id)).toEqual([
      river,
      money,
    ])
  })

  it('takes one live inventory per entry', async () => {
    const world = fakeWorld()
    const { entry } = await headword(world, 'run')
    await submit(world, inventory(entry.id, [{ pos: 'verb', gloss: 'to move fast', rank: 'common' }]))
    await expect(
      submit(world, inventory(entry.id, [{ pos: 'verb', gloss: 'to go quickly', rank: 'common' }])),
    ).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('submitting grammar, topics, word formation, and collocations', () => {
  it('refuses grammar that does not fit the sense part of speech', async () => {
    const { world, river } = await bankWorld()
    await expect(
      submit(world, { kind: 'grammar', subject_id: river, payload: { transitivity: 'transitive' } }),
    ).rejects.toMatchObject({ code: 'invalid_reference', message: expect.stringContaining('remove transitivity') })
    const by = await headword(world, 'by', [{ pos: 'preposition', gloss: 'near or beside' }])
    await expect(
      submit(world, { kind: 'grammar', subject_id: by.senses[0]!, payload: { countability: 'countable' } }),
    ).rejects.toMatchObject({
      code: 'invalid_reference',
      message: expect.stringContaining('this one is preposition'),
    })
    await expect(
      submit(world, { kind: 'grammar', subject_id: by.entry.id, payload: { countability: 'countable' } }),
    ).rejects.toMatchObject({ code: 'invalid_reference' })
  })

  it('tags only a leaf topic, at most three per sense', async () => {
    const { world, river } = await bankWorld()
    const tag = (topic: string) =>
      submit(world, { kind: 'topic', subject_id: river, payload: { topic_id: topic as TopicId } })
    await expect(tag('nowhere')).rejects.toMatchObject({
      code: 'invalid_reference',
      message: expect.stringContaining('does not exist'),
    })
    await expect(tag('home')).rejects.toMatchObject({
      code: 'invalid_reference',
      message: expect.stringContaining('topic category'),
    })
    for (const leaf of ['furniture', 'kitchen', 'dentist']) await tag(leaf)
    await expect(tag('body-parts')).rejects.toMatchObject({
      code: 'conflict',
      message: 'A sense holds at most 3 live topic facts; retract one before adding another.',
    })
  })

  it('refuses a word formation of a phrase or one whose parts do not spell the word', async () => {
    const { world, entry } = await bankWorld()
    const phrase = await headword(world, 'river bank')
    const base = (form: string) => ({ parts: [{ form, role: 'base' as const }] })
    await expect(
      submit(world, { kind: 'morphology', subject_id: phrase.entry.id, payload: base('riverbank') }),
    ).rejects.toMatchObject({ code: 'invalid_reference' })
    await expect(
      submit(world, { kind: 'morphology', subject_id: entry.id, payload: base('bunk') }),
    ).rejects.toMatchObject({
      code: 'invalid_reference',
    })
    expect((await submit(world, { kind: 'morphology', subject_id: entry.id, payload: base('bank') })).created).toBe(
      true,
    )
  })

  it('takes a base lemma only of a live entry, and links the derivative into its family [spec: facts/morphology-base-lemma-usecase]', async () => {
    const world = fakeWorld()
    const { entry: student } = await headword(world, 'student')
    const morphology: SubmitFactInput = {
      kind: 'morphology',
      subject_id: student.id,
      payload: {
        parts: [
          { form: 'study', role: 'base', lemma: 'study' },
          { form: '-ent', role: 'suffix' },
        ],
      },
    }
    const refused = {
      code: 'invalid_reference',
      message:
        '"study" is not the lemma of a live entry; a base names an entry exactly as it is spelled. Leave the lemma out, or name the word in blocked_on.',
    }
    await expect(submit(world, morphology)).rejects.toMatchObject(refused)
    const study = await world.deps.nodes.insertEntry({
      id: crypto.randomUUID() as EntryId,
      lemma: 'study' as Lemma,
      createdBy: 'admin:admin-1' as never,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    await expect(submit(world, morphology)).rejects.toMatchObject(refused)
    await headword(world, 'study')
    const { fact } = await submit(world, morphology)
    expect((await world.deps.nodes.loadEntrySnapshot(study)).family).toEqual(['student'])
    await retractFact(world.deps, agentA, fact.id)
    expect((await world.deps.nodes.loadEntrySnapshot(study)).family).toEqual([])
  })

  it('takes a collocation with a live form of the word and caps a sense at five [spec: facts/collocation-cap]', async () => {
    const { world, entry, river } = await bankWorld()
    const collocation = (text: string, supersedes_id?: FactId): SubmitFactInput => ({
      kind: 'collocation',
      subject_id: river,
      payload: { text, pattern: 'adjective_noun' },
      ...(supersedes_id ? { supersedes_id } : {}),
    })
    await expect(submit(world, collocation('steep banks'))).rejects.toMatchObject({ code: 'invalid_reference' })
    await submit(world, { kind: 'form', subject_id: entry.id, payload: { form: 'banks', type: 'plural' } })
    const facts = []
    for (const text of ['steep banks', 'muddy bank', 'grassy bank', 'opposite bank', 'far bank']) {
      facts.push((await submit(world, collocation(text))).fact)
    }
    await expect(submit(world, collocation('low bank'))).rejects.toMatchObject({
      code: 'conflict',
      message: 'A sense holds at most 5 live collocation facts; retract one before adding another.',
    })
    expect((await submit(world, collocation('muddy bank'))).created).toBe(false)
    await drainReviews(world)
    const correction = await submit(world, collocation('low bank', facts[0]!.id))
    expect(correction).toMatchObject({ created: true, fact: { supersedesId: facts[0]!.id } })
  })

  it('refuses a periphrastic comparison as a form', async () => {
    const { world, entry } = await bankWorld()
    await expect(
      submit(world, { kind: 'form', subject_id: entry.id, payload: { form: 'most banky', type: 'superlative' } }),
    ).rejects.toMatchObject({ code: 'invalid_reference', message: expect.stringContaining('periphrastic') })
  })
})

describe('reading facts', () => {
  it('gets a fact by id and 404s an unknown one', async () => {
    const { world, river } = await bankWorld()
    const { fact } = await submit(world, example(river, 'We sat on the bank.'))
    await expect(getFact(world.deps, fact.id)).resolves.toMatchObject({ id: fact.id })
    await expect(getFact(world.deps, 'missing' as FactId)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('lists the facts one principal authored about the entry with exactly this lemma [spec: monitor/fact-filters]', async () => {
    const { world, river } = await bankWorld()
    await submit(world, example(river, 'We sat on the bank.'), agentB)
    const about = async (lemma: string, author?: string) =>
      (await listFacts(world.deps, { lemma, author }, { limit: 50 })).items
    const facts = await about(' bank ')
    expect(facts.map((fact) => fact.kind).sort()).toEqual(['example', 'senses'])
    expect(new Set(facts.map((fact) => fact.entry.lemma))).toEqual(new Set(['bank']))
    const { entry, ...first } = facts[0]!
    await expect(getFactWithEntry(world.deps, first.id)).resolves.toEqual({ ...first, entry })
    await expect(getFactWithEntry(world.deps, crypto.randomUUID() as FactId)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(await about('Bank')).toEqual([])
    expect((await about('bank', 'agent:agent-b')).map((fact) => fact.kind)).toEqual(['example'])
    expect((await listFacts(world.deps, { kind: 'senses', status: 'published' }, { limit: 10 })).items).toHaveLength(2)
  })
})

describe('retractFact', () => {
  it('lets the author retract, and retracting again returns the same fact [spec: facts/retract]', async () => {
    const { world, river } = await bankWorld()
    const { fact } = await submit(world, example(river, 'We sat on the bank.'))
    expect((await retractFact(world.deps, agentA, fact.id)).status).toBe('retracted')
    await expect(retractFact(world.deps, agentA, fact.id)).resolves.toMatchObject({ status: 'retracted' })
  })

  it("forbids an agent from retracting another agent's fact, but not an admin", async () => {
    const { world, river } = await bankWorld()
    const { fact } = await submit(world, example(river, 'We sat on the bank.'))
    await expect(retractFact(world.deps, agentB, fact.id)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(retractFact(world.deps, admin, fact.id)).resolves.toMatchObject({ status: 'retracted' })
  })

  it('refuses a rejected fact', async () => {
    const { world, river } = await bankWorld()
    const fact = await rejected(world, example(river, 'x'))
    await expect(retractFact(world.deps, agentA, fact.id)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('reports a concurrent change instead of claiming success', async () => {
    const { world, river } = await bankWorld()
    const { fact } = await submit(world, example(river, 'We sat on the bank.'))
    world.deps.facts.transition = async () => false
    await expect(retractFact(world.deps, agentA, fact.id)).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('rereviewFact', () => {
  it('sends a rejected fact back to pending and enqueues it [spec: facts/rereview]', async () => {
    const { world, river } = await bankWorld()
    const fact = await rejected(world, example(river, 'x'))
    await expect(rereviewFact(world.deps, admin, fact.id)).resolves.toMatchObject({ status: 'pending' })
    expect(world.queued).toEqual([{ factId: fact.id, traceId: 'trace-admin' }])
  })

  it('re-enqueues a pending fact without changing it', async () => {
    const { world, river } = await bankWorld()
    const { fact } = await submit(world, example(river, 'x'))
    world.queued.length = 0
    await expect(rereviewFact(world.deps, admin, fact.id)).resolves.toMatchObject({ status: 'pending' })
    expect(world.queued).toHaveLength(1)
  })

  it('refuses published and retracted facts, and rejected facts whose content is live again', async () => {
    const { world, river } = await bankWorld()
    const published = await decided(world, example(river, 'We sat on the bank.'))
    await expect(rereviewFact(world.deps, admin, published.id)).rejects.toMatchObject({
      code: 'conflict',
      message: 'A published fact cannot be re-reviewed.',
    })
    await retractFact(world.deps, agentA, published.id)
    await expect(rereviewFact(world.deps, admin, published.id)).rejects.toMatchObject({ code: 'conflict' })
    const failed = await rejected(world, example(river, 'x'))
    await submit(world, example(river, 'x'), curatorAgent)
    await expect(rereviewFact(world.deps, admin, failed.id)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('refuses to revive a fact that no longer fits its subject [spec: facts/rereview-admits]', async () => {
    const { world, entry, river } = await bankWorld()
    const { fact: form } = await submit(world, {
      kind: 'form',
      subject_id: entry.id,
      payload: { form: 'banks', type: 'plural' },
    })
    const fact = await rejected(world, {
      kind: 'collocation',
      subject_id: river,
      payload: { text: 'steep banks', pattern: 'adjective_noun' },
    })
    await retractFact(world.deps, agentA, form.id)
    await expect(rereviewFact(world.deps, admin, fact.id)).rejects.toMatchObject({
      code: 'invalid_reference',
      message: 'A collocation contains the word: "steep banks" has neither "bank" nor one of its live forms.',
    })
    await expect(getFact(world.deps, fact.id)).resolves.toMatchObject({ status: 'rejected' })
    world.deps.nodes.findSense = async () => null
    await expect(rereviewFact(world.deps, admin, fact.id)).rejects.toThrow('which does not exist')
  })

  it('refuses to revive a word formation whose base is no longer a live entry', async () => {
    const world = fakeWorld()
    const { entry: student } = await headword(world, 'student')
    const study = await headword(world, 'study')
    const fact = await rejected(world, {
      kind: 'morphology',
      subject_id: student.id,
      payload: {
        parts: [
          { form: 'study', role: 'base', lemma: 'study' },
          { form: '-ent', role: 'suffix' },
        ],
      },
    })
    world.work.get(study.entry.id)!.live = false
    await expect(rereviewFact(world.deps, admin, fact.id)).rejects.toMatchObject({ code: 'invalid_reference' })
  })

  it('applies the relation write rules when a rejected relation comes back', async () => {
    const { world, river, shore } = await bankWorld()
    const antonym = await rejected(world, relation(river, 'antonym', shore))
    await submit(world, relation(river, 'synonym', shore))
    await expect(rereviewFact(world.deps, admin, antonym.id)).rejects.toMatchObject({ code: 'invalid_reference' })
    world.senses.splice(
      world.senses.findIndex((sense) => sense.id === shore),
      1,
    )
    await expect(rereviewFact(world.deps, admin, antonym.id)).rejects.toThrow('links a sense that does not exist')
  })

  it('refuses a relation whose end became rare when it comes back', async () => {
    const { world, river, shoreEntry, shore } = await bankWorld()
    const hypernym = await rejected(world, relation(river, 'hypernym', shore))
    const list = world.facts.find(
      (fact) => fact.kind === 'senses' && fact.subjectId === shoreEntry.id,
    ) as FactOf<'senses'>
    world.facts[world.facts.indexOf(list)] = {
      ...list,
      payload: { senses: [{ ...list.payload.senses[0]!, rank: 'extra' }] },
    }
    await expect(rereviewFact(world.deps, admin, hypernym.id)).rejects.toMatchObject({
      message: expect.stringContaining("is in the extra senses of its entry's sense list"),
    })
  })

  it('refuses to revive a rejected fact when its subject is at its kind cap', async () => {
    const { world, river } = await bankWorld()
    const tag = (topic: string) => ({
      kind: 'topic' as const,
      subject_id: river,
      payload: { topic_id: topic as TopicId },
    })
    const failed = await rejected(world, tag('body-parts'))
    for (const leaf of ['furniture', 'kitchen', 'dentist']) await submit(world, tag(leaf))
    await expect(rereviewFact(world.deps, admin, failed.id)).rejects.toMatchObject({
      code: 'conflict',
      message: 'A sense holds at most 3 live topic facts; retract one before adding another.',
    })
  })

  it('refuses to revive a fact while a live correction supersedes it [spec: facts/rereview-under-correction]', async () => {
    const { world, river } = await bankWorld()
    const original = await decided(world, example(river, 'We sat on the bank.'))
    await submit(world, example(river, 'We sat on the grassy bank.', original.id))
    setStatus(world, original.id, 'rejected')
    await expect(rereviewFact(world.deps, admin, original.id)).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining('review that correction instead'),
    })
    expect((await getFact(world.deps, original.id)).status).toBe('rejected')
  })

  it('refuses a rejected correction whose original is no longer published [spec: facts/correction-needs-published]', async () => {
    const { world, river } = await bankWorld()
    const original = await decided(world, example(river, 'We sat on the bank.'))
    const correction = await rejected(world, example(river, 'A fish.', original.id))
    await retractFact(world.deps, agentA, original.id)
    await expect(rereviewFact(world.deps, admin, correction.id)).rejects.toMatchObject({
      code: 'conflict',
      message: 'Only a published fact can be superseded; it is retracted.',
    })
    expect((await getFact(world.deps, correction.id)).status).toBe('rejected')
  })

  it('reports a concurrent change', async () => {
    const { world, river } = await bankWorld()
    const fact = await rejected(world, example(river, 'x'))
    world.deps.facts.transition = async () => false
    await expect(rereviewFact(world.deps, admin, fact.id)).rejects.toMatchObject({
      code: 'conflict',
      message: 'The fact changed while it was being reset.',
    })
  })
})
