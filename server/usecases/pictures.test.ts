import type { FactOf } from '@server/domain/fact'
import { admin, agentA } from '@server/testing/actors'
import { type FakeWorld, fakeWorld } from '@server/testing/fakes'
import { drainReviews, headword } from '@server/testing/seed'
import { webpHeader } from '@server/testing/webp'
import type { SenseId, SentenceId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { getPublicEntry, listPublicEntries } from './catalog'
import { retractFact, submitFact } from './facts'
import { storePicture } from './media'

const none = { lang: null, review: false }

async function bankWorld() {
  const world = fakeWorld()
  const bank = await headword(world, 'bank', [
    { pos: 'noun', gloss: 'An organization that keeps money for its customers.' },
    { pos: 'noun', gloss: 'The land along the edge of a river.' },
  ])
  const [money, river] = bank.senses as [SenseId, SenseId]
  return { world, money, river }
}

/** A distinct stored picture: pictures differ by their bytes. */
async function picture(world: FakeWorld, seed: number) {
  const bytes = webpHeader(1024, 1024)
  bytes[63] = seed
  return storePicture(world.deps, bytes)
}

/** The LLM's blind guesses, then its verdict on the picture. */
function lookAnswers(world: FakeWorld, guesses: string[], verdict: 'pass' | 'fail') {
  world.chooseLlm(() => ({ guesses }))
  world.answerLlm(() => ({ model: 'llm-test', verdict, confidence: 0.9, reason: `The picture ${verdict}s.` }))
}

const image = (subject: SenseId, image_id: string, sentence_id?: SentenceId) =>
  ({ kind: 'image', subject_id: subject, payload: { image_id, ...(sentence_id ? { sentence_id } : {}) } }) as const

describe('pictures', () => {
  it('stores a square WebP under its SHA-256 once, and refuses anything else [spec: facts/picture-upload]', async () => {
    const world = fakeWorld()
    const bytes = webpHeader(1024, 1024)
    const stored = await storePicture(world.deps, bytes)
    expect(stored.id).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.url).toBe(`/v1/media/${stored.id}`)
    expect(await storePicture(world.deps, bytes)).toEqual(stored)
    expect(world.media.size).toBe(1)
    await expect(storePicture(world.deps, webpHeader(512, 512))).rejects.toMatchObject({
      code: 'invalid_request',
      message: 'A picture is 1024×1024; this one is 512×512.',
    })
    expect(world.media.size).toBe(1)
  })

  it('accepts an image fact only for a stored picture and an existing sentence [spec: facts/image-submit]', async () => {
    const { world, money } = await bankWorld()
    await expect(submitFact(world.deps, agentA, image(money, 'f'.repeat(64)))).rejects.toMatchObject({
      code: 'invalid_reference',
      message: `Picture ${'f'.repeat(64)} is not stored; upload it with POST /manage/v1/media first.`,
    })
    const stored = await picture(world, 1)
    const unknown = '00000000-0000-4000-8000-0000000000aa' as SentenceId
    await expect(submitFact(world.deps, agentA, image(money, stored.id, unknown))).rejects.toMatchObject({
      code: 'invalid_reference',
    })
    const { fact, created } = await submitFact(world.deps, agentA, image(money, stored.id))
    expect([created, fact.status, fact.contentKey, fact.objectId]).toEqual([true, 'pending', stored.id, null])
  })

  it('has the LLM guess what the picture shows without the word, then judge it with those guesses [spec: facts/image-review-flow]', async () => {
    const { world, money, river } = await bankWorld()
    const good = await picture(world, 1)
    lookAnswers(world, ['bank', 'money', 'savings', 'deposit', 'teller'], 'pass')
    world.llmCalls.length = 0
    world.llmPictures.length = 0
    const { fact } = await submitFact(world.deps, agentA, image(money, good.id))
    await drainReviews(world)
    const reviewed = world.facts.find((candidate) => candidate.id === fact.id) as FactOf<'image'>
    expect(reviewed.status).toBe('published')
    expect(reviewed.review).toMatchObject({
      reviewer: 'llm',
      verdict: 'pass',
      detail: { guesses: ['bank', 'money', 'savings', 'deposit', 'teller'] },
    })
    // Both calls see the picture; only the second names the word.
    expect(world.llmCalls).toHaveLength(2)
    expect(world.llmCalls[0]?.user).not.toContain('bank')
    expect(world.llmCalls[1]?.user).toContain('"bank" (noun)')
    expect(world.llmCalls[1]?.user).toContain('"money", "savings"')
    expect(world.llmPictures.map((pictures) => pictures.map((url) => url.slice(0, 23)))).toEqual([
      ['data:image/webp;base64,'],
      ['data:image/webp;base64,'],
    ])

    const wrong = await picture(world, 2)
    lookAnswers(world, ['river', 'riverbank', 'shore', 'boat', 'reeds'], 'fail')
    const rejected = await submitFact(world.deps, agentA, image(river, wrong.id))
    await drainReviews(world)
    expect(world.facts.find((candidate) => candidate.id === rejected.fact.id)?.status).toBe('rejected')
  })

  it('treats blind guesses that break their contract as a protocol failure, never a verdict', async () => {
    const { world, money } = await bankWorld()
    const stored = await picture(world, 1)
    world.chooseLlm(() => ({ guess: 'bank' }))
    const { fact } = await submitFact(world.deps, agentA, image(money, stored.id))
    await expect(drainReviews(world)).rejects.toThrow('Blind guesses do not match their contract.')
    expect(world.facts.find((candidate) => candidate.id === fact.id)?.status).toBe('pending')
  })

  it('shows a published picture on its sense, the first one on the entry, and in the summaries [spec: catalog/picture]', async () => {
    const { world, money, river } = await bankWorld()
    const first = await picture(world, 1)
    const second = await picture(world, 2)
    lookAnswers(world, ['bank'], 'pass')
    await submitFact(world.deps, agentA, image(river, second.id))
    await drainReviews(world)
    const read = async () => (await getPublicEntry(world.deps, 'bank', none)).read()
    // The second sense's picture is the entry's while the first sense has none.
    let entry = await read()
    expect(entry.image).toEqual({ url: second.url, sentence: null, sense_id: river })
    expect(entry.meanings[0]?.senses.map((sense) => sense.image)).toEqual([null, { url: second.url, sentence: null }])

    const { fact } = await submitFact(world.deps, agentA, image(money, first.id))
    await drainReviews(world)
    entry = await read()
    expect(entry.image).toEqual({ url: first.url, sentence: null, sense_id: money })
    const reviewed = (await getPublicEntry(world.deps, 'bank', { lang: null, review: true })).read()
    expect(reviewed.image?.review?.fact_id).toBe(fact.id)
    const filter = { prefix: '', levels: [], pos: null, topic: null }
    const listed = await listPublicEntries(world.deps, filter, 'lemma', { limit: 10 }, none)
    expect(listed.items.map((item) => item.image_url)).toEqual([first.url])

    await retractFact(world.deps, agentA, fact.id)
    expect((await read()).image?.sense_id).toBe(river)
  })

  it('shows the picture of an example only while that example is published, with its sentence [spec: catalog/picture-example]', async () => {
    const { world, money } = await bankWorld()
    const example = await submitFact(world.deps, agentA, {
      kind: 'example',
      subject_id: money,
      payload: { text: 'She keeps her savings in the bank.' },
    })
    await drainReviews(world)
    const sentence = (example.fact as FactOf<'example'>).payload.sentence_id
    const stored = await picture(world, 1)
    lookAnswers(world, ['bank', 'savings'], 'pass')
    await submitFact(world.deps, agentA, image(money, stored.id, sentence))
    await drainReviews(world)
    const read = async () => (await getPublicEntry(world.deps, 'bank', none)).read()
    expect((await read()).image).toEqual({
      url: stored.url,
      sentence: 'She keeps her savings in the bank.',
      sense_id: money,
    })
    await retractFact(world.deps, admin, example.fact.id)
    const entry = await read()
    expect(entry.image).toBeNull()
    expect(entry.meanings[0]?.senses[0]?.image).toBeNull()
  })
})
