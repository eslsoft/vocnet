import { publicEntrySchema } from '@shared/catalog'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { call, curated, headword, issueAgentKey, readFact, reviewPending, submit, submitOk } from './helpers'

const read = async (lemma: string, query = '') =>
  publicEntrySchema.parse((await call(`/v1/entries/${encodeURIComponent(lemma)}${query}`)).body)

const errorCode = (body: unknown) => apiErrorSchema.parse(body).error.code

describe('productive uses', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps one productive use per part of speech of the common senses [spec: facts/productive-use-admission]', async () => {
    const { entryId } = await headword('run', [
      { pos: 'verb', gloss: 'To move fast on foot.' },
      { pos: 'noun', gloss: 'An act of running.' },
      { pos: 'adjective', gloss: 'Melted.', rank: 'extra' },
    ])
    const token = await issueAgentKey()
    const verb = await submit(token, 'productive_use', entryId, { pos: 'verb', native: true, learner: true })
    expect(verb.status).toBe(201)
    const again = await submit(token, 'productive_use', entryId, { pos: 'verb', native: true, learner: false })
    expect([again.status, errorCode(again.body)]).toEqual([409, 'conflict'])
    const noun = await submit(token, 'productive_use', entryId, { pos: 'noun', native: true, learner: false })
    expect(noun.status).toBe(201)
    // An extra sense needs none and admits none; a word natives only understand is passive for a learner.
    const rare = await submit(token, 'productive_use', entryId, { pos: 'adjective', native: false, learner: false })
    expect([rare.status, errorCode(rare.body)]).toEqual([422, 'invalid_reference'])
    const learnerOnly = await submit(token, 'productive_use', entryId, { pos: 'noun', native: false, learner: true })
    expect([learnerOnly.status, errorCode(learnerOnly.body)]).toEqual([400, 'invalid_request'])
  })

  it('publishes on two Jev answers at 0.8 and serves each tier with its skills [spec: catalog/productive-use-api]', async () => {
    const { entryId } = await headword('gobsmacked', [
      { pos: 'adjective', gloss: 'Extremely surprised.', register: 'informal', region: 'british' },
      { pos: 'verb', gloss: 'To astonish.', rank: 'extra', register: 'dated' },
    ])
    const token = await issueAgentKey()
    const fact = await submitOk(token, 'productive_use', entryId, { pos: 'adjective', native: true, learner: false })
    await reviewPending({ jev: 0.8 })
    const reviewed = await readFact(fact.id)
    expect([reviewed.status, reviewed.review?.reviewer]).toEqual(['published', 'jev'])

    const entry = await read('gobsmacked', '?include=review')
    expect(entry.meanings.map(({ pos, productive_use, skills }) => ({ pos, productive_use, skills }))).toEqual([
      {
        pos: 'adjective',
        productive_use: { native: true, learner: false },
        skills: { native: ['listen', 'speak'], learner: ['listen'] },
      },
      {
        pos: 'verb',
        productive_use: { native: false, learner: false },
        skills: { native: ['listen', 'read'], learner: ['listen', 'read'] },
      },
    ])
    expect(entry.meanings[0]?.review?.productive_use?.fact_id).toBe(fact.id)
    expect(entry.meanings[1]?.review?.productive_use).toBeNull()
  })

  it('leaves a part of speech without a published productive use unmarked [spec: catalog/productive-use-api]', async () => {
    const { entryId } = await headword('henceforth', [
      { pos: 'adverb', gloss: 'From this time on.', register: 'formal' },
    ])
    const token = await issueAgentKey()
    await submitOk(token, 'productive_use', entryId, { pos: 'adverb', native: false, learner: false })
    expect((await read('henceforth')).meanings[0]).toMatchObject({ productive_use: null, skills: null })
    // Below the threshold the LLM decides; its fail rejects the claim and the slot stays open.
    await reviewPending({ jev: 0.79, verdict: 'fail' })
    expect((await read('henceforth')).meanings[0]).toMatchObject({ productive_use: null, skills: null })
    await curated('productive_use', entryId, { pos: 'adverb', native: false, learner: false })
    expect((await read('henceforth')).meanings[0]).toMatchObject({
      productive_use: { native: false, learner: false },
      skills: { native: ['read'], learner: ['read'] },
    })
  })
})
