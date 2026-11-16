import { env } from 'cloudflare:test'
import { handleScheduled } from '@server/worker'
import { publicEntrySchema, publicSentenceSchema } from '@shared/catalog'
import { workItemOverviewListSchema } from '@shared/monitor'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adminToken,
  call,
  curated,
  headword,
  issueAgentKey,
  managed,
  publishInventory,
  readFact,
  reviewPending,
  stubReviewers,
  submit,
  submitOk,
} from './helpers'

const itemsOf = async (entryId: string) =>
  workItemOverviewListSchema.parse(
    (await call(`/manage/v1/work/items?entry_id=${entryId}`, { token: await adminToken() })).body,
  ).items

describe('phrases lists', () => {
  afterEach(() => vi.restoreAllMocks())

  it('admits the phrases a published list names as entries of the headword batch [spec: facts/phrases-api]', async () => {
    const give = await headword('give', [{ pos: 'verb', gloss: 'To hand something to someone.' }], 2)
    const front = await headword('front', [{ pos: 'noun', gloss: 'The part of something that faces forward.' }])
    const token = await issueAgentKey()
    const giveList = await submitOk(token, 'phrases', give.entryId, {
      phrases: [
        { type: 'phrasal_verb', text: 'give up' },
        { type: 'phrasal_verb', text: 'give in' },
      ],
    })
    await submitOk(token, 'phrases', front.entryId, { phrases: [{ type: 'phrasal_verb', text: 'in front of' }] })
    // The list names its phrases by text: their entries exist, not live, until it publishes.
    expect((await managed('give up')).live).toBe(false)
    await reviewPending()
    expect((await readFact(giveList.id)).status).toBe('published')

    const giveUp = await managed('give up')
    expect([giveUp.live, giveUp.batch]).toEqual([true, 2])
    const inFrontOf = await managed('in front of')
    expect([inFrontOf.live, inFrontOf.batch]).toEqual([true, 1])
    expect((await itemsOf(giveUp.entry.id)).map((item) => item.type)).toEqual(['senses'])

    const onPhrase = await submit(token, 'phrases', giveUp.entry.id, {
      phrases: [{ type: 'phrasal_verb', text: 'give up on' }],
    })
    expect([onPhrase.status, apiErrorSchema.parse(onPhrase.body).error.code]).toEqual([422, 'invalid_reference'])

    await publishInventory(giveUp.entry.id, [{ pos: 'verb', gloss: 'To stop trying to do something.' }])
    const listed = publicEntrySchema.parse((await call('/v1/entries/give')).body)
    expect(listed.phrases.phrasal_verbs.map((phrase) => phrase.lemma)).toEqual(['give up'])

    await curated('phrases', give.entryId, { phrases: [{ type: 'phrasal_verb', text: 'give in' }] }, giveList.id)
    const dropped = await managed('give up')
    expect(dropped.live).toBe(false)
    expect(await itemsOf(dropped.entry.id)).toEqual([])
    expect(publicEntrySchema.parse((await call('/v1/entries/give')).body).phrases).toEqual({
      by_sense: [],
      phrasal_verbs: [],
      idioms: [],
      compounds: [],
      sayings: [],
    })
  })

  it('admits every phrase of a long list, past the bound parameters one statement takes [spec: facts/phrases-api]', async () => {
    const take = await headword('take', [{ pos: 'verb', gloss: 'To get something into your hands.' }])
    const phrases = Array.from({ length: 30 }, (_, at) => `take part${at}`)
    const list = await curated('phrases', take.entryId, {
      phrases: phrases.map((text) => ({ type: 'phrasal_verb', text })),
    })
    expect(list.status).toBe('published')
    const admitted = await Promise.all(phrases.map((phrase) => managed(phrase)))
    expect(admitted.every((entry) => entry.live && entry.batch === 1)).toBe(true)
  })

  it('types each item, keeps a saying a sentence, and gives the headword its translation and meaning [spec: facts/phrases-typed-api]', async () => {
    const bank = await headword('bank', [{ pos: 'noun', gloss: 'An organization that keeps money.' }])
    const money = bank.senses[0] as string
    const token = await issueAgentKey()
    const refused = await submit(token, 'phrases', bank.entryId, {
      phrases: [{ type: 'compound', text: 'bank account', sense_id: crypto.randomUUID() }],
    })
    expect([refused.status, apiErrorSchema.parse(refused.body).error.code]).toEqual([422, 'invalid_reference'])
    expect((await call('/manage/v1/entries/bank%20account', { token })).status).toBe(404)
    const lowercase = await submit(token, 'phrases', bank.entryId, {
      phrases: [{ type: 'saying', text: 'never bank on luck' }],
    })
    expect(lowercase.status).toBe(400)

    const list = await submitOk(token, 'phrases', bank.entryId, {
      phrases: [
        { type: 'compound', text: 'bank account', sense_id: money },
        { type: 'saying', text: 'Never bank on luck.' },
      ],
    })
    await reviewPending()
    expect((await readFact(list.id)).status).toBe('published')
    const view = await managed('bank')
    const stored = view.facts.find((fact) => fact.id === list.id)
    expect(stored?.payload).toEqual({
      phrases: [
        { type: 'compound', entry_id: expect.any(String), sense_id: money, text: 'bank account' },
        { type: 'saying', sentence_id: expect.any(String), text: 'Never bank on luck.' },
      ],
    })
    const saying = (stored?.payload as { phrases: Array<{ sentence_id?: string }> }).phrases[1]?.sentence_id as string
    const account = await managed('bank account')
    expect([account.live, account.phrase_type]).toEqual([true, 'compound'])
    expect((await call('/manage/v1/entries/Never%20bank%20on%20luck.', { token })).status).toBe(404)

    const items = await itemsOf(bank.entryId)
    expect(items.find((item) => item.type === 'sayings')?.gap).toEqual({ type: 'sayings', missing: [saying] })
    await submitOk(token, 'sentence_meaning', saying, { gloss: 'Do not rely on chance.' })
    await submitOk(token, 'translation', saying, { language: 'zh', of: 'sentence', text: '别指望运气。' })
    await reviewPending()
    expect((await itemsOf(bank.entryId)).map((item) => item.type)).not.toContain('sayings')

    await publishInventory(account.entry.id, [{ pos: 'noun', gloss: 'An arrangement to keep money in a bank.' }])
    const entry = publicEntrySchema.parse((await call('/v1/entries/bank?lang=zh')).body)
    expect(entry.phrases.by_sense).toEqual([
      { sense_id: money, phrases: [expect.objectContaining({ lemma: 'bank account' })] },
    ])
    expect(entry.phrases.sayings).toEqual([
      {
        sentence_id: saying,
        text: 'Never bank on luck.',
        meaning: 'Do not rely on chance.',
        translation: '别指望运气。',
      },
    ])
    const phrase = publicEntrySchema.parse((await call('/v1/entries/bank%20account')).body)
    expect(phrase.phrase_type).toBe('compound')
    const read = await call(`/v1/sentences/${saying}?lang=zh`)
    const sentence = publicSentenceSchema.parse(read.body)
    expect(sentence).toEqual({
      lang: 'zh',
      id: saying,
      text: 'Never bank on luck.',
      source: null,
      meaning: 'Do not rely on chance.',
      translation: '别指望运气。',
      examples_of: [],
      saying_of: ['bank'],
    })
    expect((await call(`/v1/sentences/${crypto.randomUUID()}`)).status).toBe(404)
  })

  it('the cron finishes a published list whose admission did not complete [spec: facts/phrases-api]', async () => {
    const hand = await headword('hand', [{ pos: 'noun', gloss: 'The part of the body at the end of the arm.' }])
    await curated('phrases', hand.entryId, {
      phrases: [
        { type: 'phrasal_verb', text: 'hand in' },
        { type: 'phrasal_verb', text: 'hand out' },
      ],
    })
    const handIn = await managed('hand in')
    // As if the admission failed after the list was published.
    await env.DB.prepare('update worklist set live = 0 where entry_id = ?').bind(handIn.entry.id).run()
    expect((await managed('hand in')).live).toBe(false)

    // The run also classifies the entries' open productive uses.
    stubReviewers()
    await handleScheduled(env)
    expect((await managed('hand in')).live).toBe(true)
    expect((await itemsOf(handIn.entry.id)).map((item) => item.type)).toEqual(['senses'])
  })
})
