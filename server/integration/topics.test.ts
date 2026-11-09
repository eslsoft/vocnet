import { env } from 'cloudflare:test'
import { createEntryResultSchema, createSenseResultSchema, publicEntrySchema } from '@shared/catalog'
import { factPageSchema, factWriteResultSchema } from '@shared/facts'
import { topicSensePageSchema, topicTreeSchema } from '@shared/topics'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminToken, call, deliverPendingReviews, deliverReviews, issueAgentKey, stubReviewers } from './helpers'

async function seedNurse() {
  const token = await issueAgentKey()
  const entry = async (lemma: string) =>
    createEntryResultSchema.parse((await call('/manage/v1/entries', { method: 'POST', token, json: { lemma } })).body)
  const sense = async (entryId: string, pos: string, gloss: string) =>
    createSenseResultSchema.parse(
      (await call('/manage/v1/senses', { method: 'POST', token, json: { entry_id: entryId, pos, gloss } })).body,
    ).sense
  const nurse = await entry('nurse')
  const care = await sense(nurse.entry.id, 'noun', 'A person trained to care for the sick.')
  const tend = await sense(nurse.entry.id, 'verb', 'To care for someone who is ill.')
  const ward = await entry('ward')
  const room = await sense(ward.entry.id, 'noun', 'A room in a hospital for patients.')
  const at = await entry('at')
  const place = await sense(at.entry.id, 'preposition', 'In or near a place.')
  const submit = (subjectId: string, topicId: string) =>
    call('/manage/v1/facts', {
      method: 'POST',
      token,
      json: { kind: 'topic', subject_id: subjectId, payload: { topic_id: topicId } },
    })
  return { token, care, tend, room, place, submit }
}

const codeOf = (body: unknown) => apiErrorSchema.parse(body).error
const senses = async (topicId: string, query = '') => {
  const { status, body } = await call(`/v1/topics/${topicId}/senses${query}`)
  expect(status).toBe(200)
  return topicSensePageSchema.parse(body)
}

describe('topics', () => {
  afterEach(() => vi.restoreAllMocks())

  it('serves the seeded taxonomy as 16 categories over 147 leaf topics [spec: topics/tree-api]', async () => {
    const { status, body } = await call('/v1/topics')
    expect(status).toBe(200)
    const { categories } = topicTreeSchema.parse(body)
    expect(categories).toHaveLength(16)
    expect(categories.flatMap((category) => category.topics)).toHaveLength(147)
    expect(categories[0]).toMatchObject({
      id: 'people-feelings',
      name_en: 'People and feelings',
      name_zh: '人物与情感',
    })
    expect(categories[0]?.topics[0]).toEqual({ id: 'family', name_en: 'Family', name_zh: '家庭' })
    const health = categories.find((category) => category.id === 'body-health')
    expect(health?.topics.map((topic) => topic.id)).toContain('hospital-doctor')
  })

  it('reviews and publishes a topic fact, then lists its sense under the leaf and its category [spec: topics/publish-api]', async () => {
    const { care, tend, room, submit } = await seedNurse()
    const tagged = await submit(care.id, 'hospital-doctor')
    expect(tagged.status).toBe(201)
    const { fact } = factWriteResultSchema.parse(tagged.body)
    expect(fact).toMatchObject({ kind: 'topic', subject_id: care.id, object_id: null, status: 'pending' })
    expect((await submit(care.id, 'hospital-doctor')).status).toBe(200)
    expect((await submit(room.id, 'hospital-doctor')).status).toBe(201)
    expect((await submit(tend.id, 'injury-first-aid')).status).toBe(201)
    expect((await senses('hospital-doctor')).items).toEqual([])

    stubReviewers()
    await deliverPendingReviews()

    const published = await call(`/manage/v1/facts/${fact.id}`, { token: await adminToken() })
    expect(published.body).toMatchObject({ status: 'published', review: { reviewer: 'jev' } })
    expect((published.body as { review: { context: unknown } }).review.context).toMatchObject({
      topic: { category: 'Body and health', topic: 'At the doctor and hospital' },
    })

    const leaf = await senses('hospital-doctor')
    expect(leaf).toEqual({
      items: [
        { id: care.id, lemma: 'nurse', pos: 'noun', gloss: 'A person trained to care for the sick.' },
        { id: room.id, lemma: 'ward', pos: 'noun', gloss: 'A room in a hospital for patients.' },
      ],
      next_cursor: null,
    })
    const first = await senses('body-health', '?limit=2')
    expect(first.items.map((item) => item.id)).toEqual([care.id, tend.id].sort() as string[])
    const second = await senses('body-health', `?limit=2&cursor=${first.next_cursor}`)
    expect(second).toEqual({ items: [leaf.items[1]], next_cursor: null })
    expect((await senses('home')).items).toEqual([])

    const entry = publicEntrySchema.parse((await call('/v1/entries/nurse')).body)
    expect(entry.senses.find((sense) => sense.id === care.id)?.topics).toEqual([
      { id: fact.id, confidence: 0.93, verdict: 'pass', topic_id: 'hospital-doctor' },
    ])
    const listed = factPageSchema.parse(
      (await call('/manage/v1/facts?kind=topic&limit=10', { token: await adminToken() })).body,
    )
    expect(listed.items).toHaveLength(3)
  })

  it('hides a tagged sense until its gloss and entry publish, and after the topic is retracted [spec: topics/visibility]', async () => {
    const { token, care, submit } = await seedNurse()
    const { fact } = factWriteResultSchema.parse((await submit(care.id, 'hospital-doctor')).body)
    stubReviewers()
    const { body } = await call('/manage/v1/facts?status=pending&kind=topic', { token: await adminToken() })
    await deliverReviews(factPageSchema.parse(body).items.map((item) => item.id))
    expect((await senses('hospital-doctor')).items).toEqual([])
    await deliverPendingReviews()
    expect((await senses('hospital-doctor')).items.map((item) => item.id)).toEqual([care.id])
    expect((await call(`/manage/v1/facts/${fact.id}/retract`, { method: 'POST', token })).status).toBe(200)
    expect((await senses('hospital-doctor')).items).toEqual([])
  })

  it('refuses unknown topics, categories, function-word senses, and a fourth topic [spec: topics/write-rules-api]', async () => {
    const { care, place, submit } = await seedNurse()
    const unknown = await submit(care.id, 'no-such-topic')
    expect(unknown.status).toBe(422)
    expect(codeOf(unknown.body)).toMatchObject({ code: 'invalid_reference' })
    const category = await submit(care.id, 'body-health')
    expect(category.status).toBe(422)
    expect(codeOf(category.body).message).toContain('is a topic category')
    const preposition = await submit(place.id, 'hospital-doctor')
    expect(preposition.status).toBe(422)
    expect(codeOf(preposition.body).message).toContain('this one is preposition')
    const malformed = await submit(care.id, 'Not A Topic')
    expect(malformed.status).toBe(400)

    for (const topic of ['hospital-doctor', 'illness-symptoms', 'medicine-pharmacy']) {
      expect((await submit(care.id, topic)).status).toBe(201)
    }
    const fourth = await submit(care.id, 'dentist')
    expect(fourth.status).toBe(409)
    expect(codeOf(fourth.body).message).toBe(
      'A sense holds at most 3 live topic facts; retract one before adding another.',
    )
    const live = await env.DB.prepare("select count(*) as n from facts where kind = 'topic'").first<{ n: number }>()
    expect(live?.n).toBe(3)
  })

  it('404s an unknown topic id and 400s a malformed one [spec: topics/not-found]', async () => {
    const missing = await call('/v1/topics/no-such-topic/senses')
    expect(missing.status).toBe(404)
    expect(codeOf(missing.body).code).toBe('not_found')
    expect((await call('/v1/topics/Hospital/senses')).status).toBe(400)
  })
})
