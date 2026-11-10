import { env } from 'cloudflare:test'
import { createDeps } from '@server/composition'
import type { Actor } from '@server/usecases/facts'
import { rereviewFact, submitFact } from '@server/usecases/facts'
import { reviewFact } from '@server/usecases/review'
import type { AgentId } from '@shared/agents'
import { createEntryResultSchema, createSenseResultSchema, publicEntrySchema } from '@shared/catalog'
import { type FactId, factPageSchema, factWriteResultSchema, submitFactInputSchema } from '@shared/facts'
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
  return { token, care, tend, room, place, submit }
}

const codeOf = (body: unknown) => apiErrorSchema.parse(body).error
const ALREADY_CORRECTED =
  'The fact this corrects already has a live correction; retract that one or wait for its review.'

/** A sense with three published topic facts, the most a sense holds. */
async function fullSense() {
  const seeded = await seedNurse()
  const tags = []
  for (const topic of ['hospital-doctor', 'illness-symptoms', 'medicine-pharmacy']) {
    tags.push(factWriteResultSchema.parse((await seeded.submit(seeded.care.id, topic)).body).fact)
  }
  stubReviewers()
  await deliverPendingReviews()
  const [original] = tags
  if (!original) throw new Error('No first topic fact.')
  return { ...seeded, tags, original }
}

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

const adminActor: Actor = { principal: { kind: 'admin', sub: 'admin-1' }, traceId: 't' }
async function agentActor(): Promise<Actor> {
  const agent = await env.DB.prepare('select id, name from agents limit 1').first<{ id: string; name: string }>()
  if (!agent) throw new Error('No agent.')
  return { principal: { kind: 'agent', agentId: agent.id as AgentId, name: agent.name }, traceId: 't' }
}

/**
 * Real use-case dependencies whose fact reads run `interleave` once, right after the first read of
 * `id`: a concurrent write lands between that read and the write that follows it.
 */
function interleavedAfterRead(id: string, interleave: () => Promise<unknown>) {
  const deps = createDeps(env)
  let pending = true
  return {
    ...deps,
    facts: {
      ...deps.facts,
      async find(read: FactId) {
        const found = await deps.facts.find(read)
        if (read === id && pending) {
          pending = false
          await interleave()
        }
        return found
      },
    },
  }
}
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
    expect(published.body).toMatchObject({ status: 'published', review: { reviewer: 'llm' } })
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
      { id: fact.id, confidence: 0.88, verdict: 'pass', topic_id: 'hospital-doctor' },
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
    const setStatus = (id: string, status: string) =>
      env.DB.prepare('update facts set status = ? where id = ?').bind(status, id).run()
    const rereview = async (id: string) =>
      call(`/manage/v1/facts/${id}/rereview`, { method: 'POST', token: await adminToken() })

    const first = await submit(care.id, 'dentist', original.id)
    expect(first.status).toBe(201)
    const correction = factWriteResultSchema.parse(first.body).fact
    await refused(submit(care.id, 'injury-first-aid', original.id), ALREADY_CORRECTED)
    await refused(submit(care.id, 'injury-first-aid'))

    // The re-review takes its original's place only while no other correction holds it.
    await setStatus(correction.id, 'rejected')
    const second = factWriteResultSchema.parse((await submit(care.id, 'injury-first-aid', original.id)).body).fact
    await refused(rereview(correction.id), ALREADY_CORRECTED)
    await setStatus(second.id, 'rejected')
    expect((await rereview(correction.id)).body).toMatchObject({ status: 'pending' })
    await deliverPendingReviews()
    const live = await env.DB.prepare(
      "select id, status from facts where kind = 'topic' and status in ('pending', 'published') order by id",
    ).all<{ id: string; status: string }>()
    expect(live.results.map((row) => row.id).sort()).toEqual([tags[0]?.id, tags[1]?.id, correction.id].sort())
    expect(live.results.every((row) => row.status === 'published')).toBe(true)
    const superseded = await env.DB.prepare('select status from facts where id = ?').bind(original.id).first()
    expect(superseded).toEqual({ status: 'superseded' })
  })

  it('refuses to re-review a topic while its correction is live [spec: topics/rereview-under-correction-api]', async () => {
    const { care, submit } = await seedNurse()
    const tags = []
    for (const topic of ['hospital-doctor', 'illness-symptoms', 'medicine-pharmacy']) {
      tags.push(factWriteResultSchema.parse((await submit(care.id, topic)).body).fact)
    }
    stubReviewers()
    await deliverPendingReviews()
    const original = tags[0]
    if (!original) throw new Error('No first topic fact.')
    const correction = factWriteResultSchema.parse((await submit(care.id, 'dentist', original.id)).body).fact

    const rereview = await call(`/manage/v1/facts/${original.id}/rereview`, {
      method: 'POST',
      token: await adminToken(),
    })
    expect(rereview.status).toBe(409)
    expect(codeOf(rereview.body)).toEqual({
      code: 'conflict',
      message: 'A live correction supersedes this fact; review that correction instead.',
    })
    expect(await statusOf(original.id)).toBe('published')
    await deliverReviews([correction.id, original.id])

    expect(await statusOf(original.id)).toBe('superseded')
    expect(await statusOf(correction.id)).toBe('published')
    const published = await env.DB.prepare(
      "select count(*) as n from facts where kind = 'topic' and subject_id = ? and status = 'published'",
    )
      .bind(care.id)
      .first<{ n: number }>()
    expect(published?.n).toBe(3)
  })

  it('refuses a correction whose original an admin re-reviews between its check and its insert [spec: topics/correction-race-api]', async () => {
    const { care, original } = await fullSense()
    const racing = interleavedAfterRead(original.id, () => rereviewFact(createDeps(env), adminActor, original.id))
    const input = submitFactInputSchema.parse({
      kind: 'topic',
      subject_id: care.id,
      payload: { topic_id: 'dentist' },
      supersedes_id: original.id,
    })
    await expect(submitFact(racing, await agentActor(), input)).rejects.toMatchObject({
      code: 'conflict',
      message: 'Only a published fact can be superseded; it is pending.',
    })

    await deliverPendingReviews()
    const rows = await topicRows(care.id)
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.status === 'published' && row.supersedes_id === null)).toBe(true)
  })

  it('refuses to revive a rejected correction whose original an admin re-reviews meanwhile [spec: topics/correction-race-api]', async () => {
    const { care, original, submit } = await fullSense()
    const correction = factWriteResultSchema.parse((await submit(care.id, 'dentist', original.id)).body).fact
    vi.restoreAllMocks()
    stubReviewers(0.1, 'fail')
    await deliverReviews([correction.id])
    vi.restoreAllMocks()
    stubReviewers()
    expect(await statusOf(correction.id)).toBe('rejected')

    const racing = interleavedAfterRead(correction.id, () => rereviewFact(createDeps(env), adminActor, original.id))
    await expect(rereviewFact(racing, adminActor, correction.id)).rejects.toMatchObject({
      code: 'conflict',
      message: 'Only a published fact can be superseded; it is pending.',
    })
    await deliverReviews([correction.id, original.id])
    expect(await statusOf(correction.id)).toBe('rejected')
    expect(await statusOf(original.id)).toBe('published')
    expect(await publishedOf(care.id)).toHaveLength(3)
  })

  it("leaves the original published when a revalidation overtakes its correction's review [spec: topics/stale-correction-review-api]", async () => {
    const { care, original, submit, token } = await fullSense()
    const correction = factWriteResultSchema.parse((await submit(care.id, 'dentist', original.id)).body).fact
    const gloss = await env.DB.prepare(
      "select id from facts where kind = 'sense' and subject_id = ? and status = 'published'",
    )
      .bind(care.id)
      .first<{ id: string }>()
    if (!gloss) throw new Error('No published gloss.')
    const glossFix = factWriteResultSchema.parse(
      (
        await call('/manage/v1/facts', {
          method: 'POST',
          token,
          json: {
            kind: 'sense',
            subject_id: care.id,
            supersedes_id: gloss.id,
            payload: { gloss: 'Someone whose job is caring for ill or injured people.' },
          },
        })
      ).body,
    ).fact
    const deps = createDeps(env)
    let pending = true
    const racing = {
      ...deps,
      topics: {
        ...deps.topics,
        async find(id: Parameters<typeof deps.topics.find>[0]) {
          if (pending) {
            pending = false
            expect(await reviewFact(deps, glossFix.id, 't')).toBe('published')
          }
          return deps.topics.find(id)
        },
      },
    }
    expect(await reviewFact(racing, correction.id, 't')).toBe('skipped')
    expect(await statusOf(original.id)).toBe('published')

    vi.restoreAllMocks()
    stubReviewers(0.1, 'fail')
    await deliverReviews([correction.id])
    expect(await statusOf(correction.id)).toBe('rejected')
    expect(await statusOf(original.id)).toBe('published')
    expect(await publishedOf(care.id)).toHaveLength(3)
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

    // A rejected correction cannot come back beside the live one, even with room below the limit.
    await env.DB.prepare("update facts set status = 'rejected' where id = ?").bind(winner.id).run()
    const second = factWriteResultSchema.parse((await submit(care.id, 'dentist', original.id)).body).fact
    const revived = await call(`/manage/v1/facts/${winner.id}/rereview`, { method: 'POST', token: await adminToken() })
    expect(revived.status).toBe(409)
    expect(codeOf(revived.body)).toEqual({ code: 'conflict', message: ALREADY_CORRECTED })

    await deliverPendingReviews()
    expect(await publishedOf(care.id)).toEqual([second.id])
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
