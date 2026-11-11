import { env } from 'cloudflare:test'
import {
  createEntryResultSchema,
  createSenseResultSchema,
  entrySummaryPageSchema,
  managedEntrySchema,
} from '@shared/catalog'
import { factPageSchema, factWriteResultSchema, listedFactSchema } from '@shared/facts'
import { feedbackPageSchema, feedbackReceiptSchema, listedFeedbackSchema } from '@shared/feedback'
import {
  consoleStatsSchema,
  workAttemptPageSchema,
  workItemDetailSchema,
  workItemOverviewListSchema,
  workSummarySchema,
} from '@shared/monitor'
import { apiErrorSchema } from '@shared/types'
import { type WorkType, workClaimSchema, workCompletionSchema } from '@shared/work'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminToken, call, deliverPendingReviews, importLearnerData, issueAgentKey, stubReviewers } from './helpers'

const post = (token: string, path: string, json: unknown) => call(path, { method: 'POST', token, json })
const createEntry = async (token: string, lemma: string) =>
  createEntryResultSchema.parse((await post(token, '/manage/v1/entries', { lemma })).body)
const submitFact = async (token: string, json: unknown) =>
  factWriteResultSchema.parse((await post(token, '/manage/v1/facts', json)).body).fact
const settle = async (verdict: 'pass' | 'fail' = 'pass') => {
  const reviewers = verdict === 'pass' ? stubReviewers() : stubReviewers(0.05, 'fail')
  await deliverPendingReviews()
  reviewers.mockRestore()
}
const claimOf = async (token: string, type: WorkType) =>
  workClaimSchema.parse((await post(token, '/manage/v1/work/claim', { types: [type], limit: 1 })).body)
/** Claims the item of this type and completes the pass over it, running `during` while the lease is held. */
const pass = async (token: string, type: WorkType, during?: () => Promise<unknown>) => {
  const work = await claimOf(token, type)
  await during?.()
  const items = work.items.map((item) => ({ id: item.id, note: 'Tried.' }))
  const done = workCompletionSchema.parse(
    (await post(token, `/manage/v1/work/${work.lease.id}/complete`, { items })).body,
  )
  return { lease: work.lease, item: done.items[0]! }
}
const attempts = async (query: string) =>
  workAttemptPageSchema.parse((await call(`/manage/v1/work/attempts${query}`, { token: await adminToken() })).body)
const codeOf = (body: unknown) => apiErrorSchema.parse(body).error.code
const scalar = async <T>(query: string, ...binds: unknown[]) =>
  (await env.DB.prepare(query)
    .bind(...binds)
    .first<{ value: T }>())!.value

describe('console monitor', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps every item and attempt, and settles each attempt when the rescore judges its item [spec: monitor/history-api]', async () => {
    const producer = await issueAgentKey('producer')
    const { entry } = await createEntry(producer, 'dawn')
    await settle()
    // Every open item has its history row.
    expect(await scalar<number>('select count(*) as value from work_items')).toBeGreaterThan(0)
    expect(await scalar<number>('select count(*) as value from work_item_log where closed_at is null')).toBe(
      await scalar<number>('select count(*) as value from work_items'),
    )

    const syllables = await pass(producer, 'syllables', () =>
      submitFact(producer, { kind: 'syllables', subject_id: entry.id, payload: { syllables: ['dawn'] } }),
    )
    const [waiting] = (await attempts('?type=syllables')).items
    expect(waiting).toMatchObject({
      item_id: syllables.item.id,
      attempt: 1,
      entry: { id: entry.id, lemma: 'dawn' },
      type: 'syllables',
      subject_id: entry.id,
      sense_gloss: null,
      holder: syllables.lease.holder,
      outcome: 'waiting_on_review',
      note: 'Tried.',
      facts: [{ kind: 'syllables', status: 'pending', summary: 'dawn' }],
    })
    expect(waiting?.seconds).toBeGreaterThanOrEqual(0)

    // The review publishes the syllables, the rescore deletes the item and closes its attempt.
    await settle()
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

    // Three passes that add nothing: two without progress, and the third hands the item to the curators.
    for (let at = 0; at < 3; at += 1) await pass(producer, 'morphology')
    expect((await attempts('?type=morphology')).items.map((attempt) => [attempt.outcome, attempt.attempt])).toEqual([
      ['stuck', 3],
      ['no_progress', 2],
      ['no_progress', 1],
    ])
    // The ordinal counts every attempt at the item, whatever the filter lists.
    const page = await attempts('?outcome=no_progress&limit=1')
    expect(page.items.map((attempt) => attempt.attempt)).toEqual([2])
    expect((await attempts(`?outcome=no_progress&cursor=${page.next_cursor}`)).items).toHaveLength(1)
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
    const { entry } = await createEntry(admin, 'tide')
    const { sense } = createSenseResultSchema.parse(
      (
        await post(admin, '/manage/v1/senses', {
          entry_id: entry.id,
          pos: 'noun',
          gloss: 'The rise and fall of the sea.',
        })
      ).body,
    )
    await settle()
    const list = async (query: string) =>
      workItemOverviewListSchema.parse((await call(`/manage/v1/work/items?${query}`, { token: admin })).body).items
    const all = await list(`entry_id=${entry.id}`)
    expect(all.every((item) => item.entry.lemma === 'tide' && item.status === 'queued')).toBe(true)
    const ofSense = await list(`subject_id=${sense.id}`)
    expect(ofSense.length).toBeGreaterThan(0)
    expect(ofSense.every((item) => item.subject_id === sense.id)).toBe(true)
    expect(ofSense[0]).toMatchObject({ sense_gloss: 'The rise and fall of the sea.', closed_at: null })

    const { lease, items } = await claimOf(admin, 'syllables')
    const [leased] = await list(`subject_id=${entry.id}`).then((found) =>
      found.filter((item) => item.id === items[0]?.id),
    )
    expect(leased).toMatchObject({
      status: 'in_progress',
      lease: { holder: lease.holder, expires_at: lease.expires_at },
    })
    const open = workItemDetailSchema.parse((await call(`/manage/v1/work/items/${leased?.id}`, { token: admin })).body)
    expect(open).toMatchObject({ status: 'in_progress', attempts: [], agent_seconds: 0, closed_at: null })

    for (const query of ['', `entry_id=${entry.id}&subject_id=${sense.id}`]) {
      const invalid = await call(`/manage/v1/work/items?${query}`, { token: admin })
      expect([invalid.status, codeOf(invalid.body)]).toEqual([400, 'invalid_request'])
    }
  })

  it('counts facts, completeness by level, pending reviews, and open, stuck, and timed-out work [spec: monitor/stats-api]', async () => {
    await importLearnerData({ levels: { dawn: 'A1' } })
    const producer = await issueAgentKey()
    const { entry } = await createEntry(producer, 'dawn')
    await createEntry(producer, 'dusk')
    await settle()
    const morphology = await submitFact(producer, {
      kind: 'morphology',
      subject_id: entry.id,
      payload: { parts: [{ form: 'dawn', role: 'base' }] },
    })
    await settle()
    await env.DB.prepare("update facts set review = json_set(review, '$.verdict', 'uncertain') where id = ?")
      .bind(morphology.id)
      .run()
    await submitFact(producer, { kind: 'syllables', subject_id: entry.id, payload: { syllables: ['dawn'] } })
    const { lease } = await claimOf(producer, 'pronunciation')
    await env.DB.prepare('update work_leases set expires_at = ? where id = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), lease.id)
      .run()

    await call('/v1/feedback', {
      method: 'POST',
      json: { target_type: 'entry', target_id: entry.id, message: 'Missing the verb sense.' },
    })

    const read = async () =>
      consoleStatsSchema.parse((await call('/manage/v1/stats', { token: await adminToken() })).body)
    const stats = await read()
    expect(stats.feedback).toEqual({ open: 1, claimed: 0, resolved: 0, dismissed: 0 })
    expect(stats.flagged).toEqual([{ kind: 'morphology', count: 1 }])
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
    const a1 = await scalar<number>('select completeness as value from worklist where entry_id = ?', entry.id)
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
    const { entry } = await createEntry(producer, 'dawn')
    await settle()
    const created = await scalar<number>('select count(*) as value from work_item_log')
    await pass(producer, 'syllables', () =>
      submitFact(producer, { kind: 'syllables', subject_id: entry.id, payload: { syllables: ['dawn'] } }),
    )
    await settle()
    await pass(producer, 'morphology')
    const held = await claimOf(producer, 'pronunciation')

    const summary = async (window: string) =>
      workSummarySchema.parse((await call(`/manage/v1/work/summary${window}`, { token: await adminToken() })).body)
    const day = await summary('')
    expect(day).toMatchObject({ window: '24h', created, closed: 1, agents: 1 })
    expect(day.open.total).toBe(created - 1)
    expect(day.open.in_progress).toBe(1)
    expect(day.median_close_seconds).toBeGreaterThanOrEqual(0)
    expect(day.throughput).toHaveLength(24)
    expect(day.throughput.at(-1)).toMatchObject({ created, closed: 1 })
    expect(day.by_type.find((row) => row.type === 'syllables')).toMatchObject({
      stage: 4,
      open: 0,
      closed: 1,
      success_rate: 1,
    })
    expect(day.by_type.find((row) => row.type === 'morphology')).toMatchObject({ open: 1, success_rate: 0 })
    expect(day.by_type.find((row) => row.type === 'senses')).toMatchObject({
      median_attempt_seconds: null,
      success_rate: null,
    })
    expect(day.forecast.net_per_day).toBeCloseTo((1 - created) / 7)
    expect(day.forecast.net_per_day_24h).toBe(1 - created)
    expect(day.forecast.by_level[0]).toMatchObject({ level: 'A1', open: created - 1 })
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
    expect(week.throughput.at(-1)).toMatchObject({ created, closed: 1 })

    const denied = await call('/manage/v1/work/summary', { token: producer })
    expect(denied.status).toBe(403)
  })

  it('lists entries with their level, scores, slots, and open work, filtered by level, weak facts, or stuck items [spec: monitor/entry-list-api]', async () => {
    await importLearnerData({ levels: { dawn: 'A1' } })
    const producer = await issueAgentKey()
    const { entry } = await createEntry(producer, 'dawn')
    await createEntry(producer, 'dusk')
    await settle()
    const admin = await adminToken()
    const list = async (query = '') =>
      entrySummaryPageSchema.parse((await call(`/manage/v1/entries${query}`, { token: admin })).body).items
    const [dawn, dusk] = await list()
    const view = managedEntrySchema.parse((await call('/manage/v1/entries/dawn', { token: admin })).body)
    expect(dawn).toMatchObject({
      lemma: 'dawn',
      level: 'A1',
      completeness: view.completeness,
      quality: 1,
      slots: view.slots,
      open_work: { total: await scalar('select count(*) as value from work_items where entry_id = ?', entry.id) },
    })
    expect(view.slots.total).toBeGreaterThan(view.slots.published)
    expect(dusk).toMatchObject({ lemma: 'dusk', level: null })
    expect((await list('?level=A1')).map((item) => item.lemma)).toEqual(['dawn'])

    const morphology = await submitFact(producer, {
      kind: 'morphology',
      subject_id: entry.id,
      payload: { parts: [{ form: 'dawn', role: 'base' }] },
    })
    await settle()
    await env.DB.prepare("update facts set review = json_set(review, '$.verdict', 'uncertain') where id = ?")
      .bind(morphology.id)
      .run()
    expect((await list('?flagged=true')).map((item) => item.lemma)).toEqual(['dawn'])

    const claimed = await claimOf(producer, 'syllables')
    expect((await list('?prefix=dawn'))[0]?.open_work.in_progress).toBe(1)
    await post(producer, `/manage/v1/work/${claimed.lease.id}/complete`, { items: [{ id: claimed.items[0]?.id }] })
    await pass(producer, 'syllables')
    await pass(producer, 'syllables')
    expect((await list('?stuck=true')).map((item) => [item.lemma, item.open_work.stuck])).toEqual([['dawn', 1]])
  })

  it('filters facts by author and by exact lemma [spec: monitor/fact-filters-api]', async () => {
    const first = await issueAgentKey('first')
    const second = await issueAgentKey('second')
    const { entry } = await createEntry(first, 'tide')
    await post(second, '/manage/v1/senses', { entry_id: entry.id, pos: 'noun', gloss: 'The rise and fall of the sea.' })
    await createEntry(second, 'wave')
    const admin = await adminToken()
    const facts = async (query: string) =>
      factPageSchema.parse((await call(`/manage/v1/facts?${query}`, { token: admin })).body).items
    const [own] = await facts('lemma=tide&kind=entry')
    expect((await facts(`author=${encodeURIComponent(own!.author)}`)).map((fact) => fact.kind)).toEqual(['entry'])
    expect((await facts('lemma=tide')).map((fact) => fact.kind).sort()).toEqual(['entry', 'sense'])
    expect(await facts('lemma=Tide')).toEqual([])
    expect(await facts('lemma=nothing')).toEqual([])
  })

  it('reads one feedback item by id [spec: monitor/feedback-read-api]', async () => {
    const token = await issueAgentKey()
    const { entry } = await createEntry(token, 'tide')
    await settle()
    const report = await call('/v1/feedback', {
      method: 'POST',
      json: { target_type: 'entry', target_id: entry.id, message: 'Missing the verb sense.' },
    })
    const { id } = feedbackReceiptSchema.parse(report.body)
    const found = listedFeedbackSchema.parse((await call(`/manage/v1/feedback/${id}`, { token })).body)
    expect(found).toMatchObject({ id, status: 'open', message: 'Missing the verb sense.' })
    const missing = await call(`/manage/v1/feedback/${crypto.randomUUID()}`, { token })
    expect([missing.status, codeOf(missing.body)]).toEqual([404, 'not_found'])
  })

  it('lists and reads facts and feedback with the entry each is about [spec: monitor/listing-entry-api]', async () => {
    const token = await issueAgentKey()
    const { entry } = await createEntry(token, 'tide')
    const { sense, fact: gloss } = createSenseResultSchema.parse(
      (
        await post(token, '/manage/v1/senses', {
          entry_id: entry.id,
          pos: 'noun',
          gloss: 'The rise and fall of the sea.',
        })
      ).body,
    )
    await createEntry(token, 'wave')
    await settle()
    const tide = { id: entry.id, lemma: 'tide' }
    const admin = await adminToken()

    const facts = factPageSchema.parse((await call('/manage/v1/facts?limit=100', { token: admin })).body).items
    expect(facts.map((fact) => [fact.kind, fact.entry.lemma]).sort()).toEqual([
      ['entry', 'tide'],
      ['entry', 'wave'],
      ['sense', 'tide'],
    ])
    expect(listedFactSchema.parse((await call(`/manage/v1/facts/${gloss.id}`, { token })).body).entry).toEqual(tide)

    const reports = []
    for (const [target_type, target_id] of [
      ['entry', entry.id],
      ['sense', sense.id],
      ['fact', gloss.id],
    ]) {
      const report = await call('/v1/feedback', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '203.0.113.9' },
        json: { target_type, target_id, message: 'Wrong.' },
      })
      reports.push(feedbackReceiptSchema.parse(report.body).id)
    }
    const listed = feedbackPageSchema.parse((await call('/manage/v1/feedback', { token })).body).items
    expect(listed.map((item) => [item.target_type, item.entry]).sort()).toEqual([
      ['entry', tide],
      ['fact', tide],
      ['sense', tide],
    ])
    for (const id of reports) {
      expect(listedFeedbackSchema.parse((await call(`/manage/v1/feedback/${id}`, { token })).body).entry).toEqual(tide)
    }
  })

  it('backfills the history of the open items and marks every row stale [spec: monitor/history-migration]', async () => {
    const token = await issueAgentKey()
    await createEntry(token, 'tide')
    await settle()
    await env.DB.prepare('delete from work_item_log').run()
    const before = await scalar<number>('select sum(revision) as value from worklist')
    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name.endsWith('_work_history_backfill.sql'))
    if (!migration) throw new Error('The work_history_backfill migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()
    expect(
      await scalar<number>(
        'select count(*) as value from work_items join work_item_log using (id) where work_item_log.gap = work_items.gap and closed_at is null',
      ),
    ).toBe(await scalar<number>('select count(*) as value from work_items'))
    expect(await scalar<number>('select sum(revision) as value from worklist')).toBe(before + 1)
  })
})
