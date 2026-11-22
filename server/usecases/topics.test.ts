import type { TopicNode } from '@server/domain/topics'
import { admin, agentA, curatorAgent } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import { drainReviews, headword } from '@server/testing/seed'
import { webpHeader } from '@server/testing/webp'
import type { SenseId, TopicId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { rereviewFact, retractFact, submitFact } from './facts'
import { reviewFact } from './review'
import { getTopicTree, listTopicSenses, setTopicImage } from './topics'

const settle = drainReviews

async function hospitalWorld() {
  const world = fakeWorld()
  const { entry, senses } = await headword(world, 'nurse', [
    { pos: 'noun', gloss: 'A person trained to care for the sick.' },
    { pos: 'verb', gloss: 'To care for someone who is ill.' },
  ])
  const at = await headword(world, 'at', [{ pos: 'preposition', gloss: 'In or near a place.' }])
  const node = (id: SenseId | undefined) => ({ id: id as SenseId })
  return { world, entry, nurse: node(senses[0]), tend: node(senses[1]), place: node(at.senses[0]) }
}

const tag = (subject: string, topic: string) =>
  ({ kind: 'topic', subject_id: subject, payload: { topic_id: topic as TopicId } }) as const

describe('topic facts', () => {
  it('tags a content sense with a leaf topic, settled by the mean of Jev and luna or else by the LLM [spec: topics/tag]', async () => {
    const { world, nurse, tend } = await hospitalWorld()
    world.decisionCalls.length = 0
    const { fact, created } = await submitFact(world.deps, agentA, tag(nurse.id, 'hospital-doctor'))
    expect(created).toBe(true)
    expect(fact).toMatchObject({ kind: 'topic', contentKey: 'hospital-doctor', objectId: null, status: 'pending' })
    const llmBefore = world.llmCalls.length
    await settle(world)
    expect(world.decisionCalls.map((call) => call.model).sort()).toEqual(['jev', 'luna'])
    expect(world.llmCalls).toHaveLength(llmBefore)
    expect(world.facts.find((candidate) => candidate.id === fact.id)).toMatchObject({
      status: 'published',
      review: { context: { topic: { category: 'Body and health', topic: 'At the doctor and hospital' } } },
    })

    world.answerDecision('luna', (questions) => ({
      model: 'luna-test',
      answers: Object.fromEntries(Object.keys(questions).map((key) => [key, 0.2])),
    }))
    const unsure = await submitFact(world.deps, agentA, tag(tend.id, 'hospital-doctor'))
    await settle(world)
    const rubric = world.llmCalls.at(-1)?.user
    expect(rubric).toContain('"nurse" (verb)')
    expect(rubric).toContain('At the doctor and hospital')
    expect(world.facts.find((candidate) => candidate.id === unsure.fact.id)?.status).toBe('published')
  })

  it('refuses an unknown topic, a category, and a sense of a function word [spec: topics/invalid-reference]', async () => {
    const { world, nurse, place } = await hospitalWorld()
    await expect(submitFact(world.deps, agentA, tag(nurse.id, 'no-such-topic'))).rejects.toMatchObject({
      code: 'invalid_reference',
      message: 'Topic no-such-topic does not exist; GET /v1/topics lists the taxonomy.',
    })
    await expect(submitFact(world.deps, agentA, tag(nurse.id, 'body-health'))).rejects.toMatchObject({
      code: 'invalid_reference',
      message: 'body-health is a topic category; tag the sense with one of its leaf topics.',
    })
    await expect(submitFact(world.deps, agentA, tag(place.id, 'hospital-doctor'))).rejects.toMatchObject({
      code: 'invalid_reference',
      message:
        'A topic fact is about a sense whose part of speech is noun, verb, adjective, adverb; this one is preposition.',
    })
    expect(world.queued).toEqual([])
  })

  it('holds at most three live topics per sense, on submission and on re-review [spec: topics/limit]', async () => {
    const { world, nurse } = await hospitalWorld()
    for (const topic of ['hospital-doctor', 'body-parts', 'dentist']) {
      await submitFact(world.deps, agentA, tag(nurse.id, topic))
    }
    const limit = 'A sense holds at most 3 live topic facts; retract one before adding another.'
    await expect(submitFact(world.deps, agentA, tag(nurse.id, 'furniture'))).rejects.toMatchObject({
      code: 'conflict',
      message: limit,
    })
    const [first] = world.facts.filter((fact) => fact.kind === 'topic')
    if (!first) throw new Error('No topic fact.')
    await retractFact(world.deps, agentA, first.id)
    const fourth = await submitFact(world.deps, agentA, tag(nurse.id, 'furniture'))
    expect(fourth.created).toBe(true)

    // A decided fact that comes back to life must find a place among the live ones.
    world.facts.splice(
      world.facts.findIndex((fact) => fact.id === first.id),
      1,
      { ...first, status: 'rejected' },
    )
    await expect(rereviewFact(world.deps, admin, first.id)).rejects.toMatchObject({ code: 'conflict', message: limit })
    await settle(world)
    const published = world.facts.find((fact) => fact.kind === 'topic' && fact.status === 'published')
    if (!published) throw new Error('No published topic fact.')
    await expect(rereviewFact(world.deps, admin, published.id)).rejects.toMatchObject({
      code: 'conflict',
      message: 'A published fact cannot be re-reviewed.',
    })
  })

  it('lets a correction take the place of its original on a full sense [spec: topics/correct-at-limit]', async () => {
    const { world, nurse } = await hospitalWorld()
    for (const topic of ['hospital-doctor', 'body-parts', 'dentist']) {
      await submitFact(world.deps, agentA, tag(nurse.id, topic))
    }
    await settle(world)
    const original = world.facts.find((fact) => fact.kind === 'topic' && fact.contentKey === 'dentist')
    if (!original) throw new Error('No dentist topic fact.')
    const correct = (topic: string) =>
      submitFact(world.deps, agentA, { ...tag(nurse.id, topic), supersedes_id: original.id })
    const limit = {
      code: 'conflict',
      message: 'A sense holds at most 3 live topic facts; retract one before adding another.',
    }
    const corrected = {
      code: 'conflict',
      message: 'The fact this corrects already has a live correction; retract that one or wait for its review.',
    }

    const { fact: correction, created } = await correct('furniture')
    expect(created).toBe(true)
    await expect(correct('kitchen')).rejects.toMatchObject(corrected)
    await expect(submitFact(world.deps, agentA, tag(nurse.id, 'kitchen'))).rejects.toMatchObject(limit)

    // A rejected correction comes back in its original's place, unless another correction holds it.
    const reject = (id: string) => {
      const index = world.facts.findIndex((fact) => fact.id === id)
      world.facts.splice(index, 1, { ...world.facts[index], status: 'rejected' } as (typeof world.facts)[number])
    }
    reject(correction.id)
    const second = await correct('kitchen')
    await expect(rereviewFact(world.deps, admin, correction.id)).rejects.toMatchObject(corrected)
    reject(second.fact.id)
    await expect(rereviewFact(world.deps, admin, correction.id)).resolves.toMatchObject({ status: 'pending' })
    await settle(world)
    expect(world.facts.find((fact) => fact.id === original.id)?.status).toBe('superseded')
    expect(world.facts.filter((fact) => fact.kind === 'topic' && fact.status === 'published')).toHaveLength(3)
  })
})

describe('topic review context', () => {
  it('rejects a topic fact whose topic is no longer a leaf, and fails loudly on a broken taxonomy', async () => {
    const { world, nurse, tend } = await hospitalWorld()
    const { fact } = await submitFact(world.deps, agentA, tag(nurse.id, 'dentist'))
    const replace = (id: string, node?: TopicNode) => {
      const index = world.topics.findIndex((candidate) => candidate.id === id)
      world.topics.splice(index, 1, ...(node ? [node] : []))
    }
    const dentist = world.topics.find((node) => node.id === 'dentist')
    if (!dentist) throw new Error('No dentist topic.')
    replace('dentist', { ...dentist, parentId: null })
    expect(await reviewFact(world.deps, fact.id, 'trace')).toBe('rejected')
    expect(world.facts.find((candidate) => candidate.id === fact.id)?.review?.reason).toBe(
      'The referenced topic is not a leaf topic of the taxonomy.',
    )

    const orphan = await submitFact(world.deps, agentA, tag(tend.id, 'furniture'))
    replace('home')
    await expect(reviewFact(world.deps, orphan.fact.id, 'trace')).rejects.toThrow(
      'Topic furniture belongs to category home, which does not exist.',
    )
  })
})

describe('topic listings', () => {
  it('lists the taxonomy as categories with their leaf topics in display order [spec: topics/tree]', async () => {
    const world = fakeWorld()
    const named = (id: string, en: string, senses = 0, entries = 0) => ({
      id,
      name: { en, zh: `${en} (zh)` },
      image_url: null,
      sense_count: senses,
      entry_count: entries,
    })
    expect(await getTopicTree(world.deps)).toEqual({
      categories: [
        {
          ...named('body-health', 'Body and health'),
          topics: [
            named('body-parts', 'Parts of the body'),
            named('hospital-doctor', 'At the doctor and hospital'),
            named('dentist', 'At the dentist'),
          ],
        },
        {
          ...named('home', 'Home'),
          topics: [named('furniture', 'Furniture'), named('kitchen', 'In the kitchen')],
        },
      ],
    })
  })

  it('counts what each topic and category lists: its public senses, each once, and its entries [spec: topics/counts]', async () => {
    const { world, nurse, tend } = await hospitalWorld()
    await submitFact(world.deps, agentA, tag(nurse.id, 'hospital-doctor'))
    await submitFact(world.deps, agentA, tag(nurse.id, 'dentist'))
    await submitFact(world.deps, agentA, tag(tend.id, 'body-parts'))
    await settle(world)
    const [health, home] = (await getTopicTree(world.deps)).categories
    const counts = (topic: { id: string; sense_count: number; entry_count: number } | undefined) =>
      topic && [topic.id, topic.sense_count, topic.entry_count]
    // The nurse sense is tagged with two leaves of the category and counts once in it.
    // and both senses belong to one entry.
    expect(counts(health)).toEqual(['body-health', 2, 1])
    expect(health?.topics.map(counts)).toEqual([
      ['body-parts', 1, 1],
      ['hospital-doctor', 1, 1],
      ['dentist', 1, 1],
    ])
    expect(counts(home)).toEqual(['home', 0, 0])
  })

  it('lists the senses of a leaf, rolls a category up over its leaves, and 404s an unknown id [spec: topics/senses]', async () => {
    const { world, nurse, tend } = await hospitalWorld()
    await submitFact(world.deps, agentA, tag(nurse.id, 'hospital-doctor'))
    await submitFact(world.deps, agentA, tag(nurse.id, 'dentist'))
    await submitFact(world.deps, agentA, tag(tend.id, 'body-parts'))
    await settle(world)
    const page = { limit: 10 }
    const none = { lang: null, review: false }
    const ids = async (topic: string) =>
      (await listTopicSenses(world.deps, topic as TopicId, 'lemma', page, none)).items.map((item) => item.sense_id)
    expect(await ids('hospital-doctor')).toEqual([nurse.id])
    expect((await listTopicSenses(world.deps, 'hospital-doctor' as TopicId, 'lemma', page, none)).items).toEqual([
      {
        lemma: 'nurse',
        sense_id: nurse.id,
        pos: 'noun',
        cefr: null,
        cefr_source: null,
        gloss: 'A person trained to care for the sick.',
        image_url: null,
        rare: false,
      },
    ])
    expect((await ids('body-health')).sort()).toEqual([nurse.id, tend.id].sort())
    expect(await ids('furniture')).toEqual([])
    await expect(listTopicSenses(world.deps, 'no-such-topic' as TopicId, 'lemma', page, none)).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})

describe('topic pictures', () => {
  const imageOf = async (world: ReturnType<typeof fakeWorld>, id: string) =>
    (await getTopicTree(world.deps)).categories
      .flatMap((category) => [category, ...category.topics])
      .find((topic) => topic.id === id)?.image_url

  it("stores a curator's picture under its SHA-256 and serves it as the topic's image_url [spec: topics/image]", async () => {
    const world = fakeWorld()
    const picture = webpHeader(1024, 1024)
    expect(await imageOf(world, 'home')).toBeNull()

    const result = await setTopicImage(world.deps, curatorAgent, 'home' as TopicId, picture)
    const [id] = [...world.media.keys()]
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(result).toEqual({ topic_id: 'home', image_url: `https://media.test/${id}` })
    expect(world.media.get(id as string)).toEqual({ bytes: picture, contentType: 'image/webp' })
    expect(await imageOf(world, 'home')).toBe(`https://media.test/${id}`)
    expect(await imageOf(world, 'furniture')).toBeNull()

    // A leaf takes a picture as a category does; the same picture again changes nothing.
    await setTopicImage(world.deps, admin, 'furniture' as TopicId, picture)
    expect(await setTopicImage(world.deps, curatorAgent, 'home' as TopicId, picture)).toEqual(result)
    expect(world.media.size).toBe(1)
    expect(await imageOf(world, 'furniture')).toBe(`https://media.test/${id}`)
  })

  it('lets only a curator set a square WebP on a known topic, storing nothing otherwise [spec: topics/image-rules]', async () => {
    const world = fakeWorld()
    const square = webpHeader(1024, 1024)
    const set = (actor: typeof agentA, id: string, bytes: Uint8Array<ArrayBuffer>) =>
      setTopicImage(world.deps, actor, id as TopicId, bytes)
    await expect(set(agentA, 'home', square)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(set(curatorAgent, 'no-such-topic', square)).rejects.toMatchObject({ code: 'not_found' })
    await expect(set(curatorAgent, 'home', new Uint8Array(64))).rejects.toMatchObject({
      code: 'invalid_request',
      message: 'A picture is a WebP file.',
    })
    await expect(set(curatorAgent, 'home', webpHeader(1254, 1254))).rejects.toMatchObject({
      code: 'invalid_request',
      message: 'A picture is 1024×1024; this one is 1254×1254.',
    })
    await expect(set(curatorAgent, 'home', webpHeader(1024, 1024, { length: 300 * 1024 + 1 }))).rejects.toMatchObject({
      code: 'invalid_request',
    })
    expect(world.media.size).toBe(0)
    expect(world.topics.every((topic) => topic.imageId === null)).toBe(true)
  })
})
