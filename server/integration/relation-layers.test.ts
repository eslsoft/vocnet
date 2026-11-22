import { entryPageSchema, memberPageSchema, publicEntrySchema } from '@shared/catalog'
import { factWriteResultSchema } from '@shared/facts'
import { topicSensePageSchema, topicTreeSchema } from '@shared/topics'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { call, deliverPendingReviews, headword, issueAgentKey, request, stubReviewers } from './helpers'

const settle = async () => {
  const reviewers = stubReviewers()
  await deliverPendingReviews()
  reviewers.mockRestore()
}

/** A live headword with one published noun sense: its entry and sense ids. */
async function noun(_token: string, lemma: string, gloss = `A kind of thing called ${lemma}.`) {
  const { entryId, senses } = await headword(lemma, [{ pos: 'noun', gloss }])
  return { entryId, senseId: senses[0] as string }
}

async function relate(token: string, from: string, type: string, to: string, domain?: string) {
  const result = await call('/manage/v1/facts', {
    method: 'POST',
    token,
    json: { kind: 'relation', subject_id: from, payload: { type, target_sense_id: to, ...(domain ? { domain } : {}) } },
  })
  if (result.status !== 201) throw new Error(`Relation refused: ${JSON.stringify(result.body)}`)
  return factWriteResultSchema.parse(result.body).fact
}

const broaderOf = async (lemma: string, query = '') =>
  publicEntrySchema
    .parse((await call(`/v1/entries/${lemma}${query}`)).body)
    .meanings[0]?.senses[0]?.relations.broader.map((related) => [related.lemma, related.domain ?? null])

const membersOf = async (senseId: string, query = '') => {
  const result = await call(`/v1/senses/${senseId}/members${query}`)
  return memberPageSchema.parse(result.body)
}

describe('relation layers', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows the everyday layer by default and a domain layer on request, each read with its own ETag [spec: public-view/relation-layers-api]', async () => {
    const token = await issueAgentKey()
    const dog = await noun(token, 'dog')
    const animal = await noun(token, 'animal')
    const pet = await noun(token, 'pet')
    const canine = await noun(token, 'canine')
    await relate(token, dog.senseId, 'hypernym', animal.senseId)
    await relate(token, dog.senseId, 'hypernym', pet.senseId)
    await relate(token, dog.senseId, 'hypernym', canine.senseId, 'biology')
    await settle()

    expect(await broaderOf('dog')).toEqual([
      ['animal', null],
      ['pet', null],
    ])
    expect(await broaderOf('dog', '?domain=biology')).toEqual([
      ['animal', null],
      ['pet', null],
      ['canine', 'biology'],
    ])
    expect(await broaderOf('dog', '?domain=medicine')).toEqual([
      ['animal', null],
      ['pet', null],
    ])
    const narrower = publicEntrySchema.parse((await call('/v1/entries/canine?domain=biology')).body).meanings[0]
      ?.senses[0]?.relations.narrower
    expect(narrower?.map((related) => [related.lemma, related.domain])).toEqual([['dog', 'biology']])
    const etag = async (query: string) => (await request(`/v1/entries/dog${query}`)).headers.get('etag')
    expect(await etag('')).not.toBe(await etag('?domain=biology'))
    expect((await call('/v1/entries/dog?domain=zoology')).status).toBe(400)
  })

  it('lists the members of a category transitively, nearest first, each once, in pages [spec: public-view/members-api]', async () => {
    const token = await issueAgentKey()
    const animal = await noun(token, 'animal')
    const bird = await noun(token, 'bird')
    const dog = await noun(token, 'dog')
    const pet = await noun(token, 'pet')
    const eagle = await noun(token, 'eagle')
    const canine = await noun(token, 'canine')
    const carnivore = await noun(token, 'carnivore')
    await relate(token, bird.senseId, 'hypernym', animal.senseId)
    await relate(token, dog.senseId, 'hypernym', animal.senseId)
    await relate(token, dog.senseId, 'hypernym', pet.senseId)
    await relate(token, eagle.senseId, 'hypernym', bird.senseId)
    await relate(token, eagle.senseId, 'hypernym', animal.senseId)
    await relate(token, dog.senseId, 'hypernym', canine.senseId, 'biology')
    await relate(token, canine.senseId, 'hypernym', carnivore.senseId, 'biology')
    await settle()

    const all = await membersOf(animal.senseId)
    expect(all.items.map((member) => [member.lemma, member.depth])).toEqual([
      ['bird', 1],
      ['dog', 1],
      ['eagle', 1],
    ])
    expect(all.items[0]).toMatchObject({ sense_id: bird.senseId, pos: 'noun', gloss: 'A kind of thing called bird.' })
    // Each member names what it is a direct kind of within the walk: eagle is a bird and an animal;
    // dog's other category, pet, is outside it. The total counts every member on every page.
    expect(all.total).toBe(3)
    expect(all.items.map((member) => member.parents)).toEqual([
      [animal.senseId],
      [animal.senseId],
      [animal.senseId, bird.senseId].sort(),
    ])
    expect((await membersOf(bird.senseId)).items.map((member) => member.lemma)).toEqual(['eagle'])
    const first = await membersOf(animal.senseId, '?limit=2')
    expect(first.items.map((member) => member.lemma)).toEqual(['bird', 'dog'])
    const rest = await membersOf(animal.senseId, `?limit=2&cursor=${first.next_cursor}`)
    expect([rest.items.map((member) => member.lemma), rest.next_cursor]).toEqual([['eagle'], null])
    expect([first.total, rest.total]).toEqual([3, 3])
    // A domain taxonomy is walked only on request.
    expect(await membersOf(carnivore.senseId)).toMatchObject({ total: 0, items: [], next_cursor: null })
    const biology = await membersOf(carnivore.senseId, '?domain=biology')
    expect(biology.total).toBe(2)
    expect(biology.items.map((member) => [member.lemma, member.depth, member.parents])).toEqual([
      ['canine', 1, [carnivore.senseId]],
      ['dog', 2, [canine.senseId]],
    ])
    expect((await call('/v1/senses/00000000-0000-4000-8000-000000000999/members')).status).toBe(404)
  })

  it('lists an entry under a topic only when the topic tags one of its common senses [spec: public-view/topic-common-senses]', async () => {
    const token = await issueAgentKey()
    const theatre = await headword('theatre', [
      { pos: 'noun', gloss: 'A building where plays are performed.' },
      { pos: 'noun', gloss: 'A room where surgery is done.', rank: 'extra' },
    ])
    const [common = '', rare = ''] = theatre.senses
    const tag = (senseId: string) =>
      call('/manage/v1/facts', {
        method: 'POST',
        token,
        json: { kind: 'topic', subject_id: senseId, payload: { topic_id: 'healthcare' } },
      })
    expect((await tag(rare)).status).toBe(201)
    await settle()
    const listed = async () =>
      entryPageSchema.parse((await call('/v1/entries?topic=healthcare')).body).items.map((item) => item.lemma)
    expect(await listed()).toEqual([])
    // The topic's senses still list the rare sense itself.
    const senses = topicSensePageSchema.parse((await call('/v1/topics/healthcare/senses')).body)
    expect(senses.items.map((item) => [item.sense_id, item.rare])).toEqual([[rare, true]])
    // The taxonomy counts what each list shows: the rare sense, and no entry yet.
    const counted = async () => {
      const { categories } = topicTreeSchema.parse((await call('/v1/topics')).body)
      const topic = categories.flatMap((category) => category.topics).find((leaf) => leaf.id === 'healthcare')
      return [topic?.sense_count, topic?.entry_count]
    }
    expect(await counted()).toEqual([1, 0])
    expect((await tag(common)).status).toBe(201)
    await settle()
    expect(await listed()).toEqual(['theatre'])
    expect(await counted()).toEqual([2, 1])
  })
})
