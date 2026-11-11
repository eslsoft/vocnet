import {
  createEntryResultSchema,
  createSenseResultSchema,
  entryMemberPageSchema,
  entryPageSchema,
  memberPageSchema,
  publicEntrySchema,
} from '@shared/catalog'
import { factWriteResultSchema } from '@shared/facts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { call, deliverPendingReviews, issueAgentKey, request, stubReviewers } from './helpers'

const settle = async () => {
  const reviewers = stubReviewers()
  await deliverPendingReviews()
  reviewers.mockRestore()
}

/** Creates the entry with one noun sense and returns the sense id. */
async function noun(token: string, lemma: string, gloss = `A ${lemma}.`) {
  const { entry } = createEntryResultSchema.parse(
    (await call('/manage/v1/entries', { method: 'POST', token, json: { lemma } })).body,
  )
  const { sense } = createSenseResultSchema.parse(
    (await call('/manage/v1/senses', { method: 'POST', token, json: { entry_id: entry.id, pos: 'noun', gloss } })).body,
  )
  return { entryId: entry.id, senseId: sense.id }
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
    expect(all.items[0]).toMatchObject({ sense_id: bird.senseId, pos: 'noun', gloss: 'A bird.' })
    expect((await membersOf(bird.senseId)).items.map((member) => member.lemma)).toEqual(['eagle'])
    const first = await membersOf(animal.senseId, '?limit=2')
    expect(first.items.map((member) => member.lemma)).toEqual(['bird', 'dog'])
    const rest = await membersOf(animal.senseId, `?limit=2&cursor=${first.next_cursor}`)
    expect([rest.items.map((member) => member.lemma), rest.next_cursor]).toEqual([['eagle'], null])
    // A domain taxonomy is walked only on request.
    expect((await membersOf(carnivore.senseId)).items).toEqual([])
    expect(
      (await membersOf(carnivore.senseId, '?domain=biology')).items.map((member) => [member.lemma, member.depth]),
    ).toEqual([
      ['canine', 1],
      ['dog', 2],
    ])
    expect((await call('/v1/senses/00000000-0000-4000-8000-000000000999/members')).status).toBe(404)
  })

  it('lists the members of every common sense of an entry by its exact lemma [spec: public-view/entry-members-api]', async () => {
    const token = await issueAgentKey()
    const { entryId, senseId: creature } = await noun(token, 'animal', 'A creature other than a human.')
    const senseOf = async (gloss: string) =>
      createSenseResultSchema.parse(
        (await call('/manage/v1/senses', { method: 'POST', token, json: { entry_id: entryId, pos: 'noun', gloss } }))
          .body,
      ).sense.id
    const living = await senseOf('A living creature that feeds.')
    const rare = await senseOf('A specialist sense.')
    await call('/manage/v1/facts', {
      method: 'POST',
      token,
      json: { kind: 'sense_list', subject_id: entryId, payload: { common: [creature, living], extra: [rare] } },
    })
    const bird = await noun(token, 'bird')
    const cat = await noun(token, 'cat')
    const dog = await noun(token, 'dog')
    const eagle = await noun(token, 'eagle')
    const mammal = await noun(token, 'mammal')
    await relate(token, bird.senseId, 'hypernym', creature)
    await relate(token, dog.senseId, 'hypernym', creature)
    await relate(token, dog.senseId, 'hypernym', living)
    await relate(token, cat.senseId, 'hypernym', living)
    await relate(token, eagle.senseId, 'hypernym', bird.senseId)
    await relate(token, mammal.senseId, 'hypernym', rare, 'biology')
    await settle()

    const membersOfEntry = async (query = '') => {
      const result = await request(`/v1/entries/animal/members${query}`)
      expect(result.headers.get('cache-control')).toBe('public, max-age=5')
      return entryMemberPageSchema.parse(await result.json())
    }
    const all = await membersOfEntry()
    expect(all.items.map((member) => [member.lemma, member.depth, member.via])).toEqual([
      ['bird', 1, [creature]],
      ['cat', 1, [living]],
      ['dog', 1, [creature, living]],
      ['eagle', 2, [creature]],
    ])
    expect(all.items[1]).toMatchObject({ sense_id: cat.senseId, pos: 'noun', gloss: 'A cat.' })
    const first = await membersOfEntry('?limit=3')
    const rest = await membersOfEntry(`?limit=3&cursor=${first.next_cursor}`)
    expect([rest.items.map((member) => member.lemma), rest.next_cursor]).toEqual([['eagle'], null])
    expect((await membersOfEntry('?pos=noun')).items).toHaveLength(4)
    expect((await membersOfEntry('?pos=verb')).items).toEqual([])
    // The rare sense's kinds are left out even in its domain.
    expect((await membersOfEntry('?domain=biology')).items.map((member) => member.lemma)).toEqual([
      'bird',
      'cat',
      'dog',
      'eagle',
    ])
    expect((await call('/v1/entries/animals/members')).status).toBe(404)
    expect((await call('/v1/entries/animal/members?pos=thing')).status).toBe(400)
  })

  it('lists an entry under a topic only when the topic tags one of its common senses [spec: public-view/topic-common-senses]', async () => {
    const token = await issueAgentKey()
    const { entryId, senseId: common } = await noun(token, 'theatre', 'A building where plays are performed.')
    const { sense } = createSenseResultSchema.parse(
      (
        await call('/manage/v1/senses', {
          method: 'POST',
          token,
          json: { entry_id: entryId, pos: 'noun', gloss: 'A room where surgery is done.' },
        })
      ).body,
    )
    await call('/manage/v1/facts', {
      method: 'POST',
      token,
      json: { kind: 'sense_list', subject_id: entryId, payload: { common: [common], extra: [sense.id] } },
    })
    const tag = (senseId: string) =>
      call('/manage/v1/facts', {
        method: 'POST',
        token,
        json: { kind: 'topic', subject_id: senseId, payload: { topic_id: 'hospital-doctor' } },
      })
    expect((await tag(sense.id)).status).toBe(201)
    await settle()
    const listed = async () =>
      entryPageSchema.parse((await call('/v1/entries?topic=hospital-doctor')).body).items.map((item) => item.lemma)
    expect(await listed()).toEqual([])
    // The topic's senses still list the rare sense itself.
    const senses = (await call('/v1/topics/hospital-doctor/senses')).body as { items: Array<{ sense_id: string }> }
    expect(senses.items.map((item) => item.sense_id)).toEqual([sense.id])
    expect((await tag(common)).status).toBe(201)
    await settle()
    expect(await listed()).toEqual(['theatre'])
  })
})
