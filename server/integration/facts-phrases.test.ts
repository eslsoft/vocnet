import { env } from 'cloudflare:test'
import { handleScheduled } from '@server/worker'
import { publicEntrySchema } from '@shared/catalog'
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
    const giveList = await submitOk(token, 'phrases', give.entryId, { phrases: ['give up', 'give in'] })
    await submitOk(token, 'phrases', front.entryId, { phrases: ['in front of'] })
    expect((await call('/manage/v1/entries/give%20up', { token })).status).toBe(404)
    await reviewPending()
    expect((await readFact(giveList.id)).status).toBe('published')

    const giveUp = await managed('give up')
    expect([giveUp.live, giveUp.batch]).toEqual([true, 2])
    const inFrontOf = await managed('in front of')
    expect([inFrontOf.live, inFrontOf.batch]).toEqual([true, 1])
    expect((await itemsOf(giveUp.entry.id)).map((item) => item.type)).toEqual(['senses'])

    const onPhrase = await submit(token, 'phrases', giveUp.entry.id, { phrases: ['give up on'] })
    expect([onPhrase.status, apiErrorSchema.parse(onPhrase.body).error.code]).toEqual([422, 'invalid_reference'])

    await publishInventory(giveUp.entry.id, [{ pos: 'verb', gloss: 'To stop trying to do something.' }])
    const listed = publicEntrySchema.parse((await call('/v1/entries/give')).body)
    expect(listed.phrases.map((phrase) => phrase.lemma)).toEqual(['give up'])

    await curated('phrases', give.entryId, { phrases: ['give in'] }, giveList.id)
    const dropped = await managed('give up')
    expect(dropped.live).toBe(false)
    expect(await itemsOf(dropped.entry.id)).toEqual([])
    expect(publicEntrySchema.parse((await call('/v1/entries/give')).body).phrases).toEqual([])
  })

  it('admits every phrase of a long list, past the bound parameters one statement takes [spec: facts/phrases-api]', async () => {
    const take = await headword('take', [{ pos: 'verb', gloss: 'To get something into your hands.' }])
    const phrases = Array.from({ length: 30 }, (_, at) => `take part${at}`)
    const list = await curated('phrases', take.entryId, { phrases })
    expect(list.status).toBe('published')
    const admitted = await Promise.all(phrases.map((phrase) => managed(phrase)))
    expect(admitted.every((entry) => entry.live && entry.batch === 1)).toBe(true)
  })

  it('the cron finishes a published list whose admission did not complete [spec: facts/phrases-api]', async () => {
    const hand = await headword('hand', [{ pos: 'noun', gloss: 'The part of the body at the end of the arm.' }])
    await curated('phrases', hand.entryId, { phrases: ['hand in', 'hand out'] })
    const handIn = await managed('hand in')
    // As if the admission failed after the list was published.
    await env.DB.prepare('update worklist set live = 0 where entry_id = ?').bind(handIn.entry.id).run()
    expect((await managed('hand in')).live).toBe(false)

    await handleScheduled(env)
    expect((await managed('hand in')).live).toBe(true)
    expect((await itemsOf(handIn.entry.id)).map((item) => item.type)).toEqual(['senses'])
  })
})
