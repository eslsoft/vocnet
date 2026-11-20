import { env } from 'cloudflare:test'
import { webpHeader } from '@server/testing/webp'
import { publicEntrySchema } from '@shared/catalog'
import { factPageSchema, factWriteResultSchema } from '@shared/facts'
import { topicImageResultSchema } from '@shared/media'
import { topicSensePageSchema, topicTreeSchema } from '@shared/topics'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adminToken,
  call,
  deliverPendingReviews,
  deliverReviews,
  headword,
  issueAgentKey,
  publishInventory,
  request,
  stubReviewers,
} from './helpers'

async function seedNurse() {
  const token = await issueAgentKey()
  const nurse = await headword('nurse', [
    { pos: 'noun', gloss: 'A person trained to care for the sick.' },
    { pos: 'verb', gloss: 'To care for someone who is ill.' },
  ])
  const ward = await headword('ward', [{ pos: 'noun', gloss: 'A room in a hospital for patients.' }])
  const at = await headword('at', [{ pos: 'preposition', gloss: 'In or near a place.' }])
  const care = { id: nurse.senses[0] as string }
  const tend = { id: nurse.senses[1] as string }
  const room = { id: ward.senses[0] as string }
  const place = { id: at.senses[0] as string }
  const submit = (subjectId: string, topicId: string, supersedesId?: string) =>
    call('/manage/v1/facts', {
      method: 'POST',
      token,
      json: {
        kind: 'topic',
        subject_id: subjectId,
        payload: { topic_id: topicId },
        ...(supersedesId ? { supersedes_id: supersedesId } : {}),
      },
    })
  return { token, nurse, care, tend, room, place, submit }
}

const codeOf = (body: unknown) => apiErrorSchema.parse(body).error
const ALREADY_CORRECTED =
  'The fact this corrects already has a live correction; retract that one or wait for its review.'

const topicRows = async (senseId: string) =>
  (
    await env.DB.prepare(
      "select id, status, supersedes_id from facts where kind = 'topic' and subject_id = ? order by created_at, id",
    )
      .bind(senseId)
      .all<{ id: string; status: string; supersedes_id: string | null }>()
  ).results
const publishedOf = async (senseId: string) =>
  (await topicRows(senseId)).filter((row) => row.status === 'published').map((row) => row.id)
const statusOf = async (id: string) =>
  (await env.DB.prepare('select status from facts where id = ?').bind(id).first<{ status: string }>())?.status

const senses = async (topicId: string, query = '') => {
  const { status, body } = await call(`/v1/topics/${topicId}/senses${query}`)
  expect(status).toBe(200)
  return topicSensePageSchema.parse(body)
}

describe('topics', () => {
  afterEach(() => vi.restoreAllMocks())

  it('serves the seeded taxonomy as 16 categories over 147 leaf topics [spec: topics/tree-api]', async () => {
    const read = await request('/v1/topics')
    expect([read.status, read.headers.get('Cache-Control')]).toEqual([200, 'public, max-age=5'])
    const etag = read.headers.get('ETag') ?? ''
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/)
    expect((await request('/v1/topics', { headers: { 'if-none-match': etag } })).status).toBe(304)
    const { categories } = topicTreeSchema.parse(await read.json())
    expect(categories).toHaveLength(16)
    expect(categories.flatMap((category) => category.topics)).toHaveLength(147)
    expect(categories[0]).toMatchObject({
      id: 'people-feelings',
      name: { en: 'People and feelings', zh: '人物与情感' },
      sense_count: 0,
      entry_count: 0,
    })
    expect(categories[0]?.topics[0]).toEqual({
      id: 'family',
      name: { en: 'Family', zh: '家庭' },
      image_url: null,
      sense_count: 0,
      entry_count: 0,
    })
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
    const emptyEtag = (await request('/v1/topics')).headers.get('ETag') ?? ''

    stubReviewers()
    await deliverPendingReviews()

    const published = await call(`/manage/v1/facts/${fact.id}`, { token: await adminToken() })
    expect(published.body).toMatchObject({ status: 'published', review: { reviewer: 'jev+luna' } })
    expect((published.body as { review: { context: unknown } }).review.context).toMatchObject({
      topic: { category: 'Body and health', topic: 'At the doctor and hospital' },
    })

    const leaf = await senses('hospital-doctor')
    expect(leaf).toEqual({
      lang: null,
      items: [
        {
          lemma: 'nurse',
          sense_id: care.id,
          pos: 'noun',
          cefr: null,
          cefr_source: null,
          gloss: 'A person trained to care for the sick.',
          image_url: null,
          rare: false,
        },
        {
          lemma: 'ward',
          sense_id: room.id,
          pos: 'noun',
          cefr: null,
          cefr_source: null,
          gloss: 'A room in a hospital for patients.',
          image_url: null,
          rare: false,
        },
      ],
      next_cursor: null,
    })
    const first = await senses('body-health', '?limit=2')
    expect(first.items.map((item) => item.sense_id)).toEqual([care.id, tend.id].sort() as string[])
    const second = await senses('body-health', `?limit=2&cursor=${first.next_cursor}`)
    expect(second).toEqual({ lang: null, items: [leaf.items[1]], next_cursor: null })
    expect((await senses('home')).items).toEqual([])
    // The taxonomy counts what these lists show: a category counts each sense of its leaves once.
    const { categories } = topicTreeSchema.parse((await call('/v1/topics')).body)
    const health = categories.find((category) => category.id === 'body-health')
    expect([health?.sense_count, health?.entry_count]).toEqual([3, 2])
    expect(health?.topics.find((topic) => topic.id === 'hospital-doctor')).toMatchObject({
      sense_count: 2,
      entry_count: 2,
    })
    // The counts are part of the taxonomy's ETag: one from before these tags no longer matches.
    const stale = await request('/v1/topics', { headers: { 'if-none-match': emptyEtag } })
    expect(stale.status).toBe(200)

    const entry = publicEntrySchema.parse((await call('/v1/entries/nurse?lang=zh&include=review')).body)
    const nouns = entry.meanings.flatMap((meaning) => meaning.senses)
    expect(nouns.find((sense) => sense.id === care.id)?.topics).toEqual([
      {
        id: 'hospital-doctor',
        name: { en: 'At the doctor and hospital', zh: expect.any(String) },
        category: { id: 'body-health', name: { en: 'Body and health', zh: expect.any(String) } },
        review: { fact_id: fact.id, confidence: 0.93, verdict: 'pass' },
      },
    ])
    const listed = factPageSchema.parse(
      (await call('/manage/v1/facts?kind=topic&limit=10', { token: await adminToken() })).body,
    )
    expect(listed.items).toHaveLength(3)
  })

  it('lists a tagged sense only while its topic fact and the inventory that lists it are published [spec: topics/visibility]', async () => {
    const { token, nurse, care, tend, submit } = await seedNurse()
    const tagged = factWriteResultSchema.parse((await submit(care.id, 'hospital-doctor')).body).fact
    const other = factWriteResultSchema.parse((await submit(tend.id, 'hospital-doctor')).body).fact
    expect((await senses('hospital-doctor')).items).toEqual([])
    stubReviewers()
    await deliverReviews([tagged.id, other.id])
    expect((await senses('hospital-doctor')).items.map((item) => item.sense_id).sort()).toEqual(
      [care.id, tend.id].sort(),
    )
    // A curator's correction of the inventory drops the noun sense: its tag no longer shows.
    await publishInventory(
      nurse.entryId,
      [{ id: tend.id, pos: 'verb', gloss: 'To care for someone who is ill.' }],
      nurse.inventory.id,
    )
    expect((await senses('hospital-doctor')).items.map((item) => item.sense_id)).toEqual([tend.id])
    expect((await call(`/manage/v1/facts/${other.id}/retract`, { method: 'POST', token })).status).toBe(200)
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

  it('lets a correction replace a topic on a full sense, one correction at a time [spec: topics/correct-at-limit-api]', async () => {
    const { care, submit } = await seedNurse()
    const tags = []
    for (const topic of ['hospital-doctor', 'illness-symptoms', 'medicine-pharmacy']) {
      tags.push(factWriteResultSchema.parse((await submit(care.id, topic)).body).fact)
    }
    stubReviewers()
    await deliverPendingReviews()
    const original = tags[2]
    if (!original) throw new Error('No third topic fact.')
    const limit = 'A sense holds at most 3 live topic facts; retract one before adding another.'
    const refused = async (response: Promise<{ status: number; body: unknown }>, message = limit) => {
      const { status, body } = await response
      expect(status).toBe(409)
      expect(codeOf(body).message).toBe(message)
    }

    const first = await submit(care.id, 'dentist', original.id)
    expect(first.status).toBe(201)
    const correction = factWriteResultSchema.parse(first.body).fact
    await refused(submit(care.id, 'injury-first-aid', original.id), ALREADY_CORRECTED)
    await refused(submit(care.id, 'injury-first-aid'))

    await deliverPendingReviews()
    const live = await env.DB.prepare(
      "select id, status from facts where kind = 'topic' and status in ('pending', 'published') order by id",
    ).all<{ id: string; status: string }>()
    expect(live.results.map((row) => row.id).sort()).toEqual([tags[0]?.id, tags[1]?.id, correction.id].sort())
    expect(live.results.every((row) => row.status === 'published')).toBe(true)
    const superseded = await env.DB.prepare('select status from facts where id = ?').bind(original.id).first()
    expect(superseded).toEqual({ status: 'superseded' })
  })

  it('holds one live correction per original, at the limit or below it [spec: topics/one-live-correction-api]', async () => {
    const { care, submit } = await seedNurse()
    const original = factWriteResultSchema.parse((await submit(care.id, 'hospital-doctor')).body).fact
    stubReviewers()
    await deliverPendingReviews()

    // Concurrent corrections of one original: the unique index admits one.
    const racing = await Promise.all(
      ['dentist', 'family', 'injury-first-aid', 'illness-symptoms'].map((topic) => submit(care.id, topic, original.id)),
    )
    expect(racing.map((response) => response.status).sort()).toEqual([201, 409, 409, 409])
    for (const response of racing.filter((candidate) => candidate.status === 409)) {
      expect(codeOf(response.body)).toEqual({ code: 'conflict', message: ALREADY_CORRECTED })
    }
    const winner = factWriteResultSchema.parse(racing.find((response) => response.status === 201)?.body).fact

    await deliverPendingReviews()
    expect(await publishedOf(care.id)).toEqual([winner.id])
    expect(await statusOf(original.id)).toBe('superseded')
    const late = await submit(care.id, 'family', original.id)
    expect(late.status).toBe(409)
    expect(codeOf(late.body).message).toBe('Only a published fact can be superseded; it is superseded.')
  })

  it('404s an unknown topic id and 400s a malformed one [spec: topics/not-found]', async () => {
    const missing = await call('/v1/topics/no-such-topic/senses')
    expect(missing.status).toBe(404)
    expect(codeOf(missing.body).code).toBe('not_found')
    expect((await call('/v1/topics/Hospital/senses')).status).toBe(400)
  })
})

describe('topic pictures', () => {
  it('sets a topic picture with a curator key and serves it forever by its id [spec: topics/image-api]', async () => {
    const curator = await issueAgentKey('Curator', true)
    const producer = await issueAgentKey()
    const picture = webpHeader(1024, 1024)
    const put = (token: string, id: string, body: Uint8Array<ArrayBuffer>) =>
      call(`/manage/v1/topics/${id}/image`, { method: 'PUT', token, headers: { 'content-type': 'image/webp' }, body })

    const set = await put(curator, 'dentist', picture)
    expect(set.status).toBe(200)
    const { image_url } = topicImageResultSchema.parse(set.body)
    expect(image_url).toMatch(/^\/v1\/media\/[0-9a-f]{64}$/)
    const { categories } = topicTreeSchema.parse((await call('/v1/topics')).body)
    const health = categories.find((category) => category.id === 'body-health')
    expect(health?.image_url).toBeNull()
    expect(health?.topics.find((topic) => topic.id === 'dentist')?.image_url).toBe(image_url)

    const read = await request(image_url)
    const id = image_url.split('/').pop()
    expect([read.status, read.headers.get('Content-Type'), read.headers.get('Cache-Control')]).toEqual([
      200,
      'image/webp',
      'public, max-age=31536000, immutable',
    ])
    expect(read.headers.get('ETag')).toBe(`"${id}"`)
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(picture)
    const again = await request(image_url, { headers: { 'if-none-match': `"${id}"` } })
    expect(again.status).toBe(304)

    const missing = await call(`/v1/media/${'0'.repeat(64)}`)
    expect([missing.status, apiErrorSchema.parse(missing.body).error.code]).toEqual([404, 'not_found'])
    expect((await call('/v1/media/not-a-hash')).status).toBe(400)
    const refused = await put(producer, 'dentist', picture)
    expect([refused.status, apiErrorSchema.parse(refused.body).error.code]).toEqual([403, 'forbidden'])
    const wrong = await put(curator, 'dentist', webpHeader(512, 512))
    expect([wrong.status, apiErrorSchema.parse(wrong.body).error.code]).toEqual([400, 'invalid_request'])
    expect((await put(curator, 'no-such-topic', picture)).status).toBe(404)
  })
})
