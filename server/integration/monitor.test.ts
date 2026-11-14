import { env } from 'cloudflare:test'
import { entrySummaryPageSchema, managedEntrySchema } from '@shared/catalog'
import { factPageSchema, listedFactSchema } from '@shared/facts'
import {
  consoleStatsSchema,
  workAttemptPageSchema,
  workItemDetailSchema,
  workItemOverviewListSchema,
  workSummarySchema,
} from '@shared/monitor'
import { feedbackReceiptSchema, listedTicketSchema, ticketPageSchema } from '@shared/tickets'
import { apiErrorSchema } from '@shared/types'
import type { WorkType } from '@shared/work'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adminToken,
  call,
  claim,
  complete,
  headword,
  importLearnerData,
  issueAgentKey,
  reviewPending,
  submitOk,
} from './helpers'

/** A live headword with one published noun sense. */
const noun = (lemma: string, gloss = `The ${lemma} of the day.`) => headword(lemma, [{ pos: 'noun', gloss }])
const claimOf = async (token: string, type: WorkType) => {
  const work = await claim(token, { types: [type], limit: 1 })
  if (!work) throw new Error(`No ${type} item to claim.`)
  return work
}
/** Claims the item of this type and completes a pass over it, running `during` while the lease is held. */
const pass = async (
  token: string,
  type: WorkType,
  during?: () => Promise<unknown>,
  done: { note?: string; found_none?: boolean } = { note: 'Tried.' },
) => {
  const work = await claimOf(token, type)
  await during?.()
  const completion = await complete(
    token,
    work.lease.id,
    work.items.map((item) => ({ id: item.id, ...done })),
  )
  return { lease: work.lease, item: completion.items[0]! }
}
const attempts = async (query: string) =>
  workAttemptPageSchema.parse((await call(`/manage/v1/work/attempts${query}`, { token: await adminToken() })).body)
const codeOf = (body: unknown) => apiErrorSchema.parse(body).error.code
const scalar = async <T>(query: string, ...binds: unknown[]) =>
  (await env.DB.prepare(query)
    .bind(...binds)
    .first<{ value: T }>())!.value
const report = (target_type: string, target_id: string, message = 'Wrong.') =>
  call('/v1/feedback', {
    method: 'POST',
    headers: { 'cf-connecting-ip': '203.0.113.9' },
    json: { target_type, target_id, message },
  })

describe('console monitor', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps every item and attempt, and settles each attempt when the rescore judges its item [spec: monitor/history-api]', async () => {
    const producer = await issueAgentKey('producer')
    const { entryId } = await noun('dawn')
    // Every open item has its history row.
    expect(await scalar<number>('select count(*) as value from work_items')).toBeGreaterThan(0)
    expect(await scalar<number>('select count(*) as value from work_item_log where closed_at is null')).toBe(
      await scalar<number>('select count(*) as value from work_items'),
    )

    const syllables = await pass(producer, 'syllables', () =>
      submitOk(producer, 'syllables', entryId, { syllables: ['dawn'] }),
    )
    const [waiting] = (await attempts('?type=syllables')).items
    expect(waiting).toMatchObject({
      item_id: syllables.item.id,
      attempt: 1,
      entry: { id: entryId, lemma: 'dawn' },
      type: 'syllables',
      subject_id: entryId,
      sense_gloss: null,
      holder: syllables.lease.holder,
      outcome: 'waiting_on_review',
      note: 'Tried.',
      facts: [{ kind: 'syllables', status: 'pending', summary: 'dawn' }],
    })
    expect(waiting?.seconds).toBeGreaterThanOrEqual(0)

    // The review publishes the syllables, the rescore deletes the item and closes its attempt.
    await reviewPending()
    const [closed] = (await attempts('?type=syllables')).items
    expect(closed).toMatchObject({ outcome: 'closed', facts: [{ status: 'published' }] })
    const detail = workItemDetailSchema.parse(
      (await call(`/manage/v1/work/items/${syllables.item.id}`, { token: await adminToken() })).body,
    )
    expect(detail).toMatchObject({
      status: 'closed',
      closed_at: expect.any(String),
      gap: { type: 'syllables' },
      lease: null,
      attempts: [{ id: closed?.id, outcome: 'closed' }],
      agent_seconds: closed?.seconds,
    })
    expect(detail.queue_seconds).toBeGreaterThanOrEqual(0)

    // An optional slot passed with found_none: the item closes and its attempt is passed.
    const phrases = await pass(producer, 'phrases', undefined, {
      found_none: true,
      note: 'Considered "dawn on"; it is a phrase of its own headword, not of the noun.',
    })
    expect(phrases.item.state).toBe('closed')
    expect((await attempts('?type=phrases')).items.map((attempt) => attempt.outcome)).toEqual(['passed'])

    // Two passes that add nothing: one without progress, and the second makes the item a ticket.
    for (let at = 0; at < 2; at += 1) await pass(producer, 'morphology')
    expect((await attempts('?type=morphology')).items.map((attempt) => [attempt.outcome, attempt.attempt])).toEqual([
      ['stuck', 2],
      ['no_progress', 1],
    ])
    // The ordinal counts every attempt at the item, whatever the filter lists.
    const page = await attempts('?outcome=stuck&limit=1')
    expect(page.items.map((attempt) => attempt.attempt)).toEqual([2])
    const first = await attempts('?limit=2')
    expect(first.items).toHaveLength(2)
    expect((await attempts(`?limit=2&cursor=${first.next_cursor}`)).items).toHaveLength(2)
    expect((await attempts(`?holder=${encodeURIComponent(syllables.lease.holder)}`)).items).toHaveLength(4)
    expect((await attempts('?lemma=dawn')).items).toHaveLength(4)
    expect((await attempts('?lemma=Dawn')).items).toEqual([])

    const denied = await call('/manage/v1/work/attempts', { token: producer })
    expect([denied.status, codeOf(denied.body)]).toEqual([403, 'forbidden'])
    const missing = await call(`/manage/v1/work/items/${crypto.randomUUID()}`, { token: await adminToken() })
    expect([missing.status, codeOf(missing.body)]).toEqual([404, 'not_found'])
  })

  it('lists the open items of an entry or a node with where each stands [spec: monitor/items-api]', async () => {
    const admin = await adminToken()
    const { entryId, senses } = await noun('tide', 'The rise and fall of the sea.')
    const sense = senses[0] as string
    const list = async (query: string) =>
      workItemOverviewListSchema.parse((await call(`/manage/v1/work/items?${query}`, { token: admin })).body).items
    const all = await list(`entry_id=${entryId}`)
    expect(all.length).toBeGreaterThan(0)
    expect(all.every((item) => item.entry.lemma === 'tide' && item.status === 'queued')).toBe(true)
    const ofSense = await list(`subject_id=${sense}`)
    expect(ofSense.length).toBeGreaterThan(0)
    expect(ofSense.every((item) => item.subject_id === sense)).toBe(true)
    expect(ofSense[0]).toMatchObject({ sense_gloss: 'The rise and fall of the sea.', closed_at: null })

    const { lease, items } = await claimOf(admin, 'syllables')
    const [leased] = (await list(`subject_id=${entryId}`)).filter((item) => item.id === items[0]?.id)
    expect(leased).toMatchObject({
      status: 'in_progress',
      lease: { holder: lease.holder, expires_at: lease.expires_at },
    })
    const open = workItemDetailSchema.parse((await call(`/manage/v1/work/items/${leased?.id}`, { token: admin })).body)
    expect(open).toMatchObject({ status: 'in_progress', attempts: [], agent_seconds: 0, closed_at: null })

    for (const query of ['', `entry_id=${entryId}&subject_id=${sense}`]) {
      const invalid = await call(`/manage/v1/work/items?${query}`, { token: admin })
      expect([invalid.status, codeOf(invalid.body)]).toEqual([400, 'invalid_request'])
    }
  })

  it('counts facts, credibility, completeness by level, pending reviews, tickets, and work [spec: monitor/stats-api]', async () => {
    await importLearnerData({ levels: { dawn: 'A1' } })
    const producer = await issueAgentKey()
    const { entryId } = await noun('dawn')
    await noun('dusk')
    // Jev is unsure of the formation and the LLM passes it: a path right less than nine times in ten.
    await submitOk(producer, 'morphology', entryId, { parts: [{ form: 'dawn', role: 'base' }] })
    await reviewPending({ jev: 0.6 })
    await submitOk(producer, 'syllables', entryId, { syllables: ['dawn'] })
    const { lease } = await claimOf(producer, 'pronunciation')
    await env.DB.prepare('update work_leases set expires_at = ? where id = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), lease.id)
      .run()
    expect((await report('entry', entryId, 'Missing the verb sense.')).status).toBe(201)

    const read = async () =>
      consoleStatsSchema.parse((await call('/manage/v1/stats', { token: await adminToken() })).body)
    const stats = await read()
    expect(stats.tickets).toEqual({ open: 1, resolved: 0, dismissed: 0 })
    expect(stats.low_credibility).toEqual([{ kind: 'morphology', count: 1 }])
    expect(stats.live_facts).toBe(
      await scalar('select count(*) as value from facts where status in (?, ?)', 'pending', 'published'),
    )
    expect(stats.completeness.by_level.map((level) => [level.level, level.entries])).toEqual([
      ['A1', 1],
      ['A2', 0],
      ['B1', 0],
      ['B2', 0],
      ['C1', 0],
      ['C2', 0],
      [null, 1],
    ])
    const a1 = await scalar<number>('select completeness as value from worklist where entry_id = ?', entryId)
    expect(stats.completeness.by_level[0]).toMatchObject({ complete: 0, average: a1 })
    expect(stats.pending_review).toEqual({ count: 1, oldest_at: expect.any(String), over_one_hour: 0 })
    expect(stats.work).toEqual({
      open: await scalar<number>('select count(*) as value from work_items'),
      stuck: 0,
      timed_out_24h: 1,
    })
    await env.DB.prepare("update facts set created_at = '2020-01-01T00:00:00.000Z' where status = 'pending'").run()
    expect((await read()).pending_review).toEqual({ count: 1, oldest_at: '2020-01-01T00:00:00.000Z', over_one_hour: 1 })
  })

  it('summarizes the work over a window: open items, throughput, attempts, forecast, and leases [spec: monitor/work-summary-api]', async () => {
    await importLearnerData({ levels: { dawn: 'A1' } })
    const producer = await issueAgentKey()
    const { entryId } = await noun('dawn')
    // The senses item the published inventory closed is created and closed work too.
    const created = await scalar<number>('select count(*) as value from work_item_log')
    expect(await scalar<number>('select count(*) as value from work_item_log where closed_at is not null')).toBe(1)
    await pass(producer, 'syllables', () => submitOk(producer, 'syllables', entryId, { syllables: ['dawn'] }))
    await reviewPending()
    await pass(producer, 'morphology')
    const held = await claimOf(producer, 'pronunciation')

    const summary = async (window: string) =>
      workSummarySchema.parse((await call(`/manage/v1/work/summary${window}`, { token: await adminToken() })).body)
    const day = await summary('')
    expect(day).toMatchObject({ window: '24h', created, closed: 2, agents: 1 })
    expect(day.open.total).toBe(created - 2)
    expect(day.open.in_progress).toBe(1)
    expect(day.median_close_seconds).toBeGreaterThanOrEqual(0)
    expect(day.throughput).toHaveLength(24)
    expect(day.throughput.at(-1)).toMatchObject({ created, closed: 2 })
    expect(day.by_type.find((row) => row.type === 'syllables')).toMatchObject({
      stage: 4,
      open: 0,
      closed: 1,
      success_rate: 1,
    })
    expect(day.by_type.find((row) => row.type === 'morphology')).toMatchObject({ open: 1, success_rate: 0 })
    expect(day.by_type.find((row) => row.type === 'senses')).toMatchObject({
      stage: 1,
      median_attempt_seconds: null,
      success_rate: null,
    })
    // The history is minutes old, so no rate is reported yet.
    expect(Date.parse(day.history_since ?? '')).toBeLessThanOrEqual(Date.now())
    expect(day.forecast).toMatchObject({ net_per_day: null, net_per_day_24h: null })
    expect(day.forecast.by_level[0]).toMatchObject({ level: 'A1', open: created - 2, net_per_day: null })
    expect(day.forecast.by_level.map((level) => level.level)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', null])
    expect(day.leases[0]).toMatchObject({
      id: held.lease.id,
      type: 'pronunciation',
      items: 1,
      lemmas: ['dawn'],
      timed_out: false,
    })
    const week = await summary('?window=7d')
    expect(week.throughput).toHaveLength(7)
    expect(week.throughput.at(-1)).toMatchObject({ created, closed: 2 })

    const denied = await call('/manage/v1/work/summary', { token: producer })
    expect(denied.status).toBe(403)
  })

  it('lists entries with their level, scores, slots, and open work, filtered by level or stuck items [spec: monitor/entry-list-api]', async () => {
    await importLearnerData({ levels: { dawn: 'A1' } })
    const producer = await issueAgentKey()
    const { entryId } = await noun('dawn')
    await noun('dusk')
    const admin = await adminToken()
    const list = async (query = '') =>
      entrySummaryPageSchema.parse((await call(`/manage/v1/entries${query}`, { token: admin })).body).items
    const [dawn, dusk] = await list()
    const view = managedEntrySchema.parse((await call('/manage/v1/entries/dawn', { token: admin })).body)
    expect(dawn).toMatchObject({
      lemma: 'dawn',
      level: 'A1',
      completeness: view.completeness,
      credibility: view.credibility,
      slots: view.slots,
      open_work: { total: await scalar('select count(*) as value from work_items where entry_id = ?', entryId) },
    })
    expect(view.slots.total).toBeGreaterThan(view.slots.published)
    expect(dusk).toMatchObject({ lemma: 'dusk', level: null })
    expect((await list('?level=A1')).map((item) => item.lemma)).toEqual(['dawn'])

    const claimed = await claimOf(producer, 'syllables')
    expect((await list('?prefix=dawn'))[0]?.open_work.in_progress).toBe(1)
    await complete(producer, claimed.lease.id, [{ id: claimed.items[0]!.id }])
    await pass(producer, 'syllables')
    expect((await list('?stuck=true')).map((item) => [item.lemma, item.open_work.stuck])).toEqual([['dawn', 1]])
  })

  it('filters facts by author and by exact lemma [spec: monitor/fact-filters-api]', async () => {
    const first = await issueAgentKey('first')
    const second = await issueAgentKey('second')
    const tide = await noun('tide', 'The rise and fall of the sea.')
    await noun('wave', 'A raised line of water.')
    const morphology = await submitOk(first, 'morphology', tide.entryId, { parts: [{ form: 'tide', role: 'base' }] })
    await submitOk(second, 'syllables', tide.entryId, { syllables: ['tide'] })
    const admin = await adminToken()
    const facts = async (query: string) =>
      factPageSchema.parse((await call(`/manage/v1/facts?${query}`, { token: admin })).body).items
    expect((await facts(`author=${encodeURIComponent(morphology.author)}`)).map((fact) => fact.kind)).toEqual([
      'morphology',
    ])
    expect((await facts('lemma=tide')).map((fact) => fact.kind).sort()).toEqual(['morphology', 'senses', 'syllables'])
    expect((await facts(`lemma=tide&author=${encodeURIComponent(morphology.author)}`)).map((fact) => fact.id)).toEqual([
      morphology.id,
    ])
    expect(await facts('lemma=Tide')).toEqual([])
    expect(await facts('lemma=nothing')).toEqual([])
  })

  it('lists and reads facts and tickets with the entry each is about [spec: monitor/listing-entry-api]', async () => {
    const token = await issueAgentKey()
    const { entryId, senses } = await noun('tide', 'The rise and fall of the sea.')
    const sense = senses[0] as string
    await noun('wave', 'A raised line of water.')
    const example = await submitOk(token, 'example', sense, { text: 'The tide came in fast.' })
    const translation = await submitOk(token, 'translation', example.object_id as string, {
      language: 'zh',
      of: 'sentence',
      text: '潮水涨得很快。',
    })
    await reviewPending()
    const tide = { id: entryId, lemma: 'tide' }
    const admin = await adminToken()

    const facts = factPageSchema.parse((await call('/manage/v1/facts?limit=100', { token: admin })).body).items
    expect(facts.map((fact) => [fact.kind, fact.entry.lemma]).sort()).toEqual([
      ['example', 'tide'],
      ['senses', 'tide'],
      ['senses', 'wave'],
      ['translation', 'tide'],
    ])
    for (const id of [example.id, translation.id]) {
      expect(listedFactSchema.parse((await call(`/manage/v1/facts/${id}`, { token })).body).entry).toEqual(tide)
    }

    const tickets = []
    for (const [type, id] of [
      ['entry', entryId],
      ['sense', sense],
      ['fact', example.id],
    ] as const) {
      const response = await report(type, id)
      expect(response.status).toBe(201)
      tickets.push(feedbackReceiptSchema.parse(response.body).id)
    }
    const listed = ticketPageSchema.parse((await call('/manage/v1/tickets', { token: admin })).body).items
    expect(listed.map((item) => [item.target_type, item.entry]).sort()).toEqual([
      ['entry', tide],
      ['fact', tide],
      ['sense', tide],
    ])
    for (const id of tickets) {
      expect(listedTicketSchema.parse((await call(`/manage/v1/tickets/${id}`, { token: admin })).body).entry).toEqual(
        tide,
      )
    }
  })

  it('plans the console counts and phrase lookups on their indexes, never a scan of every fact', async () => {
    const plan = async (query: string) =>
      (await env.DB.prepare(`explain query plan ${query}`).all<{ detail: string }>()).results
        .map((row) => row.detail)
        .join(' | ')
    // D1 runs one statement at a time: a scan of every published fact here held every request.
    expect(
      await plan(
        "select kind, json_extract(review, '$.reviewer'), count(*) from facts where status = 'published' group by kind, json_extract(review, '$.reviewer') order by kind",
      ),
    ).toContain('facts_status_kind_reviewer_idx')
    expect(await plan('select kind, status, count(*) from facts group by kind, status')).toContain(
      'COVERING INDEX facts_status_kind_reviewer_idx',
    )
    expect(
      await plan(
        "select list.id from facts as list indexed by facts_kind_payload_idx where list.kind = 'phrases' and list.status = 'published' order by list.created_at limit 1",
      ),
    ).toContain('facts_kind_payload_idx')
  })
})
