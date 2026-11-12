import { env } from 'cloudflare:test'
import { publicEntrySchema } from '@shared/catalog'
import type { SenseId } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  admit,
  call,
  calledUrls,
  curated,
  deliverReviews,
  issueAgentKey,
  JEV_URL,
  LLM_URL,
  readFact,
  senseIds,
  stubReviewers,
  submit,
  submitInventory,
} from './helpers'

const glossesOf = async (lemma: string) =>
  publicEntrySchema
    .parse((await call(`/v1/entries/${lemma}`)).body)
    .meanings.flatMap((meaning) => meaning.senses.map((sense) => [sense.id, sense.gloss]))

describe('sense inventories', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reviews an inventory, gives the entry its senses, and settles it for producers [spec: facts/inventory-api]', async () => {
    const entryId = await admit('kite')
    expect((await call('/v1/entries/kite')).status).toBe(404)
    const token = await issueAgentKey()
    const inventory = await submitInventory(token, entryId, [
      { pos: 'noun', gloss: 'A toy that flies in the wind on a long string.' },
      { pos: 'noun', gloss: 'A bird of prey with long wings.' },
    ])
    const [toy, bird] = senseIds(inventory) as [SenseId, SenseId]
    expect(inventory.status).toBe('pending')

    const gateway = stubReviewers({ jev: 0.6 })
    await deliverReviews([inventory.id])
    const jevCall = gateway.mock.calls.find(([input]) => new Request(input as RequestInfo).url === JEV_URL)
    const asked = JSON.parse(await new Request(jevCall?.[0] as RequestInfo, jevCall?.[1]).text()) as {
      questions: Record<string, unknown>
    }
    expect(Object.keys(asked.questions)).toEqual(['sense_1', 'sense_2'])
    expect(calledUrls(gateway)).toContain(LLM_URL)
    gateway.mockRestore()
    expect(await readFact(inventory.id)).toMatchObject({ status: 'published', review: { reviewer: 'jev+llm' } })
    expect(await glossesOf('kite')).toEqual([
      [toy, 'A toy that flies in the wind on a long string.'],
      [bird, 'A bird of prey with long wings.'],
    ])

    const again = await submit(
      token,
      'senses',
      entryId,
      { senses: [{ id: toy, pos: 'noun', gloss: 'A toy that flies in the wind on a long string.', rank: 'common' }] },
      { supersedes_id: inventory.id },
    )
    expect(again.status).toBe(403)
    expect(apiErrorSchema.parse(again.body).error.code).toBe('inventory_settled')

    await curated(
      'senses',
      entryId,
      { senses: [{ id: toy, pos: 'noun', gloss: 'A toy that flies in the wind on a long string.', rank: 'common' }] },
      inventory.id,
    )
    expect((await readFact(inventory.id)).status).toBe('superseded')
    expect(await glossesOf('kite')).toEqual([[toy, 'A toy that flies in the wind on a long string.']])
  })

  it('reviews an inventory knowing the live entries that differ only in letter case [spec: facts/sense-list-capitalization-api]', async () => {
    const may = await admit('may')
    await admit('May')
    const shout = await admit('MAY')
    await env.DB.prepare('update worklist set live = 0 where entry_id = ?').bind(shout).run()
    const token = await issueAgentKey()
    const inventory = await submitInventory(token, may, [
      { pos: 'auxiliary', gloss: 'Used to say that something is possible.' },
    ])
    stubReviewers({ jev: 0.6 })
    await deliverReviews([inventory.id])
    const reviewed = await readFact(inventory.id)
    expect(reviewed.review?.context).toMatchObject({ subject: { lemma: 'may', caseVariants: ['May'] } })
    expect(JSON.stringify(reviewed.review?.detail)).toContain('\\"May\\" is a separate entry')
  })
})
