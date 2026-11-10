import { createEntryResultSchema, createSenseResultSchema, publicEntrySchema } from '@shared/catalog'
import { factSchema, factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { workClaimSchema } from '@shared/work'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { call, deliverPendingReviews, issueAgentKey, stubReviewers } from './helpers'

const createEntry = async (token: string, lemma: string) =>
  createEntryResultSchema.parse((await call('/manage/v1/entries', { method: 'POST', token, json: { lemma } })).body)
const createSense = async (token: string, entryId: string, pos: string, gloss: string) =>
  createSenseResultSchema.parse(
    (await call('/manage/v1/senses', { method: 'POST', token, json: { entry_id: entryId, pos, gloss } })).body,
  )
const submit = (token: string, json: unknown) => call('/manage/v1/facts', { method: 'POST', token, json })
const refusal = (result: { status: number; body: unknown }) => [result.status, apiErrorSchema.parse(result.body).error]
/** Lets every pending review land with the LLM answering `verdict`. */
const settle = async (verdict: 'pass' | 'fail' = 'pass') => {
  const gateway = stubReviewers(0.93, verdict)
  await deliverPendingReviews()
  vi.restoreAllMocks()
  return gateway
}
/** The entry-level gap types of the one claimable entry, read by a pass that adds nothing. */
const entryGaps = async (token: string) => {
  const work = workClaimSchema.parse((await call('/manage/v1/work/claim', { method: 'POST', token })).body)
  expect((await call(`/manage/v1/work/${work.lease.id}/complete`, { method: 'POST', token })).status).toBe(200)
  return work.gaps
}

describe('sense lists', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reviews a list, publishes it in order, and reopens it when the senses change [spec: facts/sense-list-review]', async () => {
    const token = await issueAgentKey()
    const { entry } = await createEntry(token, 'book')
    const volume = await createSense(token, entry.id, 'noun', 'A written work published in printed or electronic form.')
    const reserve = await createSense(token, entry.id, 'verb', 'To arrange to have a seat or room kept for you.')
    await settle()
    const list = (common: string[], extra: string[] = [], supersedes_id?: string) => ({
      kind: 'sense_list',
      subject_id: entry.id,
      payload: { common, extra },
      ...(supersedes_id ? { supersedes_id } : {}),
    })

    expect(refusal(await submit(token, list([volume.sense.id], [volume.sense.id])))).toEqual([
      400,
      expect.objectContaining({ message: expect.stringContaining('names each sense once') }),
    ])
    expect(refusal(await submit(token, list([volume.sense.id])))).toEqual([
      422,
      expect.objectContaining({ code: 'invalid_reference', message: expect.stringContaining(reserve.sense.id) }),
    ])
    expect((await entryGaps(token)).map((gap) => gap.type)).toContain('sense_list')

    const submitted = await submit(token, list([volume.sense.id, reserve.sense.id]))
    expect(submitted.status).toBe(201)
    const original = factWriteResultSchema.parse(submitted.body).fact
    await settle()
    const published = factSchema.parse((await call(`/manage/v1/facts/${original.id}`, { token })).body)
    expect(published).toMatchObject({ status: 'published', review: { reviewer: 'llm', verdict: 'pass' } })
    const prompt = (published.review?.detail.prompt as { user: string }).user
    expect(prompt).toContain('1. (noun) "A written work published in printed or electronic form."')
    expect(prompt).toContain('2. (verb) "To arrange to have a seat or room kept for you."')
    expect((await entryGaps(token)).map((gap) => gap.type)).not.toContain('sense_list')

    // A sense added since makes the list stale until a correction names it.
    const record = await createSense(token, entry.id, 'noun', "A bookmaker's record of the bets made.")
    await settle()
    expect((await entryGaps(token)).map((gap) => gap.type)).toContain('sense_list')
    const correction = await submit(token, list([volume.sense.id, reserve.sense.id], [record.sense.id], original.id))
    expect(correction.status).toBe(201)
    await settle()
    const settled = await entryGaps(token)
    expect(settled.map((gap) => gap.type)).not.toContain('sense_list')
    expect(settled.some((gap) => 'sense_id' in gap && gap.sense_id === record.sense.id)).toBe(false)

    const entryView = publicEntrySchema.parse((await call('/v1/entries/book')).body)
    expect(entryView.senses.map((sense) => [sense.id, sense.common])).toEqual([
      [volume.sense.id, true],
      [reserve.sense.id, true],
      [record.sense.id, false],
    ])
    expect(entryView.sense_list?.id).toBe(factWriteResultSchema.parse(correction.body).fact.id)

    // A listed sense whose gloss leaves live makes it stale too; a failing review leaves the gap open.
    expect((await call(`/manage/v1/facts/${reserve.fact.id}/retract`, { method: 'POST', token })).status).toBe(200)
    const failing = await submit(
      token,
      list([volume.sense.id], [record.sense.id], factWriteResultSchema.parse(correction.body).fact.id),
    )
    expect(failing.status).toBe(201)
    await settle('fail')
    const rejected = factSchema.parse(
      (await call(`/manage/v1/facts/${factWriteResultSchema.parse(failing.body).fact.id}`, { token })).body,
    )
    expect(rejected).toMatchObject({ status: 'rejected', review: { reviewer: 'llm', verdict: 'fail' } })
    expect((await entryGaps(token)).map((gap) => gap.type)).toContain('sense_list')
  })
})
