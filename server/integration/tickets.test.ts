import { env } from 'cloudflare:test'
import { publicEntrySchema } from '@shared/catalog'
import { factSchema } from '@shared/facts'
import { feedbackReceiptSchema, listedTicketSchema, ticketPageSchema, ticketSchema } from '@shared/tickets'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adminToken,
  call,
  claim,
  complete,
  curated,
  headword,
  issueAgentKey,
  managed,
  readFact,
  reviewPending,
  submitOk,
} from './helpers'

const codeOf = (body: unknown) => apiErrorSchema.parse(body).error.code
const post = (token: string, path: string, json: unknown) => call(path, { method: 'POST', token, json })
let reporters = 0
/** A client address of its own per report unless one is given, so the report limit never couples tests. */
const nextReporter = () => {
  reporters += 1
  return `203.0.113.${reporters % 250}`
}
const report = (target_type: string, target_id: string, ip = nextReporter()) =>
  call('/v1/feedback', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip },
    json: { target_type, target_id, message: 'Something is wrong here.' },
  })
const reportOk = async (target_type: string, target_id: string) => {
  const result = await report(target_type, target_id)
  expect(result.status).toBe(201)
  return feedbackReceiptSchema.parse(result.body)
}
const ticketsOf = async (query: string, token?: string) =>
  ticketPageSchema.parse((await call(`/manage/v1/tickets${query}`, { token: token ?? (await adminToken()) })).body)
const itemTypesOf = async (entryId: string) =>
  (
    await env.DB.prepare('select type from work_items where entry_id = ?').bind(entryId).all<{ type: string }>()
  ).results.map((row) => row.type)

const NOUN = { pos: 'noun', gloss: 'The regular rise and fall of the sea.' } as const

/** A syllables item two passes left unfilled, so it is a stuck_work ticket on its entry. */
async function stuckSyllables(token: string) {
  for (let pass = 0; pass < 2; pass++) {
    const work = await claim(token, { types: ['syllables'] })
    await complete(token, work?.lease.id as string, [{ id: work?.items[0]?.id as string, note: 'Unsure.' }])
  }
}

describe('feedback', () => {
  afterEach(() => vi.restoreAllMocks())

  it('limits each client address to 10 reports a minute [spec: feedback/rate-limit]', async () => {
    const { entryId } = await headword('bay', [NOUN])
    const statuses = []
    for (let attempt = 0; attempt < 10; attempt += 1)
      statuses.push((await report('entry', entryId, '198.51.100.9')).status)
    expect(statuses).toEqual(Array(10).fill(201))
    const limited = await report('entry', entryId, '198.51.100.9')
    expect([limited.status, codeOf(limited.body)]).toEqual([429, 'rate_limited'])
    expect((await report('entry', entryId, '198.51.100.10')).status).toBe(201)
  })

  it('opens one feedback ticket per public target, and none for what the public API does not show [spec: feedback/ticket-api]', async () => {
    const producer = await issueAgentKey()
    const { entryId, senses } = await headword('tide', [NOUN])
    const sense = senses[0] as string
    const example = await curated('example', sense, { text: 'The tide came in fast.' })
    const onEntry = await reportOk('entry', entryId)
    expect(onEntry.status).toBe('open')
    const onSense = await reportOk('sense', sense)
    const onFact = await reportOk('fact', example.id)
    expect((await reportOk('entry', entryId)).id).toBe(onEntry.id)

    const listed = await ticketsOf('?type=feedback')
    expect(listed.items.map((ticket) => [ticket.id, ticket.target_type, ticket.target, ticket.status])).toEqual([
      [onEntry.id, 'entry', entryId, 'open'],
      [onSense.id, 'sense', sense, 'open'],
      [onFact.id, 'fact', example.id, 'open'],
    ])
    for (const ticket of listed.items) {
      expect(ticket).toMatchObject({
        type: 'feedback',
        message: 'Something is wrong here.',
        entry: { id: entryId, lemma: 'tide' },
      })
    }

    const pending = await submitOk(producer, 'example', sense, { text: 'The tide went out.' })
    for (const target of [
      ['fact', pending.id],
      ['sense', '00000000-0000-4000-8000-000000000000'],
    ] as const) {
      const missing = await report(target[0], target[1])
      expect([missing.status, codeOf(missing.body)]).toEqual([404, 'not_found'])
    }
    expect((await ticketsOf('?type=feedback')).items).toHaveLength(3)
  })
})

describe('tickets', () => {
  afterEach(() => vi.restoreAllMocks())

  it('lists tickets oldest first with their entry, by status and type, page by page [spec: tickets/list-api]', async () => {
    const producer = await issueAgentKey('producer')
    const curator = await issueAgentKey('curator', true)
    const { entryId, senses } = await headword('tide', [NOUN])
    const sense = senses[0] as string
    await stuckSyllables(producer)
    const example = await curated('example', sense, { text: 'The tide came in fast.' })
    const feedback = [
      await reportOk('entry', entryId),
      await reportOk('sense', sense),
      await reportOk('fact', example.id),
    ]
    const dismissed = await post(curator, `/manage/v1/tickets/${feedback[0]?.id}/resolve`, {
      resolution: 'dismissed',
      note: 'The entry is fine.',
    })
    expect(dismissed.status).toBe(200)

    const all = await ticketsOf('', curator)
    expect(all.items.map((ticket) => [ticket.type, ticket.status])).toEqual([
      ['stuck_work', 'open'],
      ['feedback', 'dismissed'],
      ['feedback', 'open'],
      ['feedback', 'open'],
    ])
    expect(all.items[0]).toMatchObject({ target_type: 'entry', target: entryId, message: 'syllables: Unsure.' })
    for (const ticket of all.items) expect(ticket.entry).toEqual({ id: entryId, lemma: 'tide' })
    expect((await ticketsOf('?status=open&type=feedback', curator)).items.map((ticket) => ticket.id)).toEqual([
      feedback[1]?.id,
      feedback[2]?.id,
    ])
    expect((await ticketsOf('?type=stuck_work', curator)).items).toHaveLength(1)
    expect((await ticketsOf('?status=dismissed', curator)).items.map((ticket) => ticket.id)).toEqual([feedback[0]?.id])

    const first = await ticketsOf('?limit=3', curator)
    expect(first.items).toHaveLength(3)
    const rest = await ticketsOf(`?limit=3&cursor=${encodeURIComponent(first.next_cursor ?? '')}`, curator)
    expect([...first.items, ...rest.items].map((ticket) => ticket.id)).toEqual(all.items.map((ticket) => ticket.id))
    expect(rest.next_cursor).toBeNull()

    const one = await call(`/manage/v1/tickets/${feedback[2]?.id}`, { token: curator })
    expect(listedTicketSchema.parse(one.body)).toMatchObject({
      target: example.id,
      entry: { id: entryId, lemma: 'tide' },
    })
    const unknown = await call('/manage/v1/tickets/00000000-0000-4000-8000-000000000000', { token: curator })
    expect([unknown.status, codeOf(unknown.body)]).toEqual([404, 'not_found'])
  })

  it('lets only a curator resolve or dismiss an open ticket, once [spec: tickets/resolve-api]', async () => {
    const producer = await issueAgentKey('producer')
    const curator = await issueAgentKey('curator', true)
    const { entryId, senses } = await headword('tide', [NOUN])
    const sense = senses[0] as string
    const [first, second, third] = [
      await reportOk('entry', entryId),
      await reportOk('sense', sense),
      await reportOk('fact', (await curated('example', sense, { text: 'The tide came in fast.' })).id),
    ]
    const fix = await submitOk(
      curator,
      'example',
      sense,
      { text: 'The tide turned at noon.' },
      { curation: { reason: 'Fixes the report.' } },
    )
    const resolve = (token: string, id: string, json: unknown) => post(token, `/manage/v1/tickets/${id}/resolve`, json)

    const refused = await resolve(producer, first?.id as string, { resolution: 'dismissed', note: 'No.' })
    expect([refused.status, codeOf(refused.body)]).toEqual([403, 'forbidden'])
    const resolved = await resolve(curator, first?.id as string, {
      resolution: 'resolved',
      fact_ids: [fix.id],
      note: 'Added an example.',
    })
    expect(resolved.status).toBe(200)
    expect(ticketSchema.parse(resolved.body)).toMatchObject({
      status: 'resolved',
      resolution_note: 'Added an example.',
      resolution_fact_ids: [fix.id],
    })
    const dismissed = await resolve(curator, second?.id as string, {
      resolution: 'dismissed',
      note: 'The sense is right.',
    })
    expect(ticketSchema.parse(dismissed.body)).toMatchObject({
      status: 'dismissed',
      resolution_note: 'The sense is right.',
      resolution_fact_ids: [],
    })
    const again = await resolve(curator, first?.id as string, { resolution: 'dismissed', note: 'Again.' })
    expect([again.status, codeOf(again.body)]).toEqual([409, 'conflict'])
    const unknownFact = await resolve(curator, third?.id as string, {
      resolution: 'resolved',
      fact_ids: ['00000000-0000-4000-8000-000000000000'],
      note: 'Fixed.',
    })
    expect([unknownFact.status, codeOf(unknownFact.body)]).toEqual([422, 'invalid_reference'])
  })

  it('lets a curator settle a required slot nothing can fill [spec: tickets/settle-slot-api]', async () => {
    const producer = await issueAgentKey('producer')
    const curator = await issueAgentKey('curator', true)
    const { entryId } = await headword('main', [
      { pos: 'adjective', gloss: 'Larger or more important than the others.' },
    ])
    // One syllable: the rules ask for -er and -est forms that "main" does not have.
    await curated('syllables', entryId, { syllables: ['main'] })
    expect(await itemTypesOf(entryId)).toContain('forms')
    const before = (await managed('main')).completeness
    const settle = (token: string) =>
      post(token, `/manage/v1/entries/${entryId}/passes`, {
        type: 'forms',
        subject_id: entryId,
        note: '"main" has no comparative or superlative.',
      })
    const refused = await settle(producer)
    expect([refused.status, codeOf(refused.body)]).toEqual([403, 'forbidden'])
    expect((await settle(curator)).status).toBe(204)
    expect(await itemTypesOf(entryId)).not.toContain('forms')
    expect((await managed('main')).completeness).toBeGreaterThan(before)
  })
})

describe('curation', () => {
  afterEach(() => vi.restoreAllMocks())

  it('refuses curation to producers and grants it to a curator key [spec: curation/curator-only]', async () => {
    const producer = await issueAgentKey('producer')
    const curator = await issueAgentKey('curator', true)
    const { senses } = await headword('kettle', [{ pos: 'noun', gloss: 'A pot for boiling water.' }])
    const sense = senses[0] as string
    const refused = await post(producer, '/manage/v1/facts', {
      kind: 'example',
      subject_id: sense,
      payload: { text: 'Put the kettle on.' },
      curation: { reason: 'Mine.' },
    })
    expect([refused.status, codeOf(refused.body)]).toEqual([403, 'forbidden'])
    const pending = await submitOk(producer, 'example', sense, { text: 'The kettle boiled.' })
    const settle = await post(producer, `/manage/v1/facts/${pending.id}/curate`, { verdict: 'pass', reason: 'x' })
    expect([settle.status, codeOf(settle.body)]).toEqual([403, 'forbidden'])

    const settled = await post(curator, `/manage/v1/facts/${pending.id}/curate`, { verdict: 'fail', reason: 'Dull.' })
    expect(settled.status).toBe(200)
    expect(factSchema.parse(settled.body)).toMatchObject({ status: 'rejected', review: { reviewer: 'curator' } })
    const written = await post(curator, '/manage/v1/facts', {
      kind: 'example',
      subject_id: sense,
      payload: { text: 'Put the kettle on.' },
      curation: { reason: 'Checked by hand.' },
    })
    expect(written.status).toBe(201)
  })

  it('publishes a curated fact without a queue delivery [spec: curation/direct-write-api]', async () => {
    const curator = await issueAgentKey('curator', true)
    const { senses } = await headword('jeans', [{ pos: 'noun', gloss: 'Trousers made of denim.' }])
    const reviewers = vi.spyOn(globalThis, 'fetch')
    const fact = await submitOk(
      curator,
      'example',
      senses[0] as string,
      { text: 'My jeans are blue.' },
      {
        curation: { reason: 'Checked by hand.' },
      },
    )
    expect(fact).toMatchObject({
      status: 'published',
      review: { reviewer: 'curator', verdict: 'pass', confidence: 1, reason: 'Checked by hand.' },
    })
    expect(fact.review?.model).toMatch(/^agent:/)
    expect(reviewers).not.toHaveBeenCalled()
    const entry = publicEntrySchema.parse((await call('/v1/entries/jeans')).body)
    expect(entry.meanings[0]?.senses[0]?.examples.map((item) => item.text)).toEqual(['My jeans are blue.'])
  })

  it('settles facts by hand and rescores the entry [spec: curation/settle-api]', async () => {
    const producer = await issueAgentKey('producer')
    const curator = await issueAgentKey('curator', true)
    const { entryId, senses } = await headword('shelve', [
      { pos: 'verb', gloss: 'To put something on a shelf.' },
      { pos: 'verb', gloss: 'To decide not to go on with a plan.' },
    ])
    const first = senses[0] as string
    const second = senses[1] as string
    const alone = await submitOk(producer, 'example', first, { text: 'Shelve the books.' })
    await reviewPending()
    expect((await readFact(alone.id)).review?.reviewer).toBe('llm')
    const rejected = await submitOk(producer, 'example', second, { text: 'They shelved the plan.' })
    await reviewPending({ verdict: 'fail' })
    expect((await readFact(rejected.id)).status).toBe('rejected')
    const before = await managed('shelve')
    expect(before.credibility).toBeLessThan(1)
    expect(
      (
        (await env.DB.prepare("select count(*) as n from work_items where type = 'examples' and subject_id = ?")
          .bind(second)
          .first<{ n: number }>()) ?? { n: 0 }
      ).n,
    ).toBe(1)

    for (const fact of [alone, rejected]) {
      const settled = await post(curator, `/manage/v1/facts/${fact.id}/curate`, { verdict: 'pass', reason: 'Right.' })
      expect(settled.status).toBe(200)
      expect(factSchema.parse(settled.body)).toMatchObject({
        status: 'published',
        review: { reviewer: 'curator', verdict: 'pass', confidence: 1 },
      })
    }
    expect((await managed('shelve')).credibility).toBe(1)
    const examplesItems = await env.DB.prepare(
      "select subject_id from work_items where entry_id = ? and type = 'examples'",
    )
      .bind(entryId)
      .all<{ subject_id: string }>()
    expect(examplesItems.results.map((row) => row.subject_id)).not.toContain(second)

    const again = await post(curator, `/manage/v1/facts/${rejected.id}/curate`, { verdict: 'fail', reason: 'No.' })
    expect(factSchema.parse(again.body).status).toBe('rejected')
    await submitOk(curator, 'example', second, { text: 'They shelved the plan.' }, { curation: { reason: 'Mine.' } })
    const collision = await post(curator, `/manage/v1/facts/${rejected.id}/curate`, { verdict: 'pass', reason: 'x' })
    expect([collision.status, codeOf(collision.body)]).toEqual([409, 'conflict'])
  })
})
