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
})
