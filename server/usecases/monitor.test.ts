import type { Fact } from '@server/domain/fact'
import type { PrincipalRef } from '@server/domain/principal'
import type { Lemma } from '@server/domain/term'
import type { TicketRecord } from '@server/domain/tickets'
import { fakeWorld } from '@server/testing/fakes'
import type { EntryId, FactId } from '@shared/facts'
import type { TicketId, TicketStatus } from '@shared/tickets'
import { MAX_PASSES, type WorkItemId, type WorkLeaseId } from '@shared/work'
import { describe, expect, it } from 'vitest'
import { getConsoleStats, getWorkItem, getWorkSummary, listOpenWorkItems, listWorkAttempts } from './monitor'
import type { MonitorRepo, WorkAttemptRecord, WorkItemRecord } from './ports'

const now = '2026-11-11T05:30:00.000Z'
const entryId = '00000000-0000-4000-8000-000000000001' as EntryId
const itemId = '00000000-0000-4000-8000-000000000002' as WorkItemId
const holder = 'agent:a' as PrincipalRef

const item = (more: Partial<WorkItemRecord> = {}): WorkItemRecord => ({
  id: itemId,
  entryId,
  lemma: 'dawn' as Lemma,
  type: 'syllables',
  subjectId: entryId,
  senseGloss: null,
  gap: { type: 'syllables' },
  awaiting: false,
  attempts: 0,
  lease: null,
  createdAt: '2026-11-11T05:00:00.000Z',
  closedAt: null,
  ...more,
})

const syllables = {
  id: '00000000-0000-4000-8000-000000000003' as FactId,
  kind: 'syllables',
  payload: { syllables: ['dawn'] },
  status: 'pending',
} as Fact

const attempt = (more: Partial<WorkAttemptRecord> = {}): WorkAttemptRecord => ({
  id: '00000000-0000-4000-8000-000000000004',
  itemId,
  ordinal: 1,
  entryId,
  lemma: 'dawn' as Lemma,
  type: 'syllables',
  subjectId: entryId,
  senseGloss: null,
  holder,
  claimedAt: '2026-11-11T05:10:00.000Z',
  completedAt: '2026-11-11T05:12:00.000Z',
  seconds: 120,
  note: null,
  outcome: 'waiting_on_review',
  facts: [syllables],
  ...more,
})

const unused = () => {
  throw new Error('not read by this use case')
}

/** A monitor repo answering each read with these rows, the rest unread. */
function monitorOf(rows: Partial<MonitorRepo>): MonitorRepo {
  const base = Object.fromEntries(
    [
      'countByCredibility',
      'countLiveFacts',
      'completenessByLevel',
      'pendingReview',
      'countOpenItems',
      'countTimedOutLeases',
      'itemFlow',
      'throughput',
      'medianCloseSeconds',
      'attemptStats',
      'listLeases',
      'countHolders',
      'historySince',
      'listAttempts',
      'listItemAttempts',
      'listOpenItems',
      'findItem',
    ].map((name) => [name, unused]),
  ) as unknown as MonitorRepo
  return { ...base, ...rows }
}

function depsWith(monitor: MonitorRepo) {
  const world = fakeWorld()
  world.setNow(now)
  return { world, deps: { ...world.deps, monitor } }
}

const open = (more: Partial<Awaited<ReturnType<MonitorRepo['countOpenItems']>>[number]>) => ({
  type: 'syllables' as const,
  levelRank: 1,
  attempts: 0,
  awaiting: false,
  leased: false,
  count: 1,
  ...more,
})

describe('console stats', () => {
  it('averages completeness overall and by level, and counts reviews, low-credibility facts, tickets, and work [spec: monitor/stats]', async () => {
    const { world, deps } = depsWith(
      monitorOf({
        countByCredibility: async () => [
          { kind: 'example', reviewer: 'llm', count: 2 },
          { kind: 'senses', reviewer: 'llm', count: 3 },
          { kind: 'relation', reviewer: 'jev+llm', count: 1 },
          { kind: 'relation', reviewer: 'llm', count: 2 },
          { kind: 'relation', reviewer: 'jev', count: 5 },
          { kind: 'relation', reviewer: 'curator', count: 4 },
          { kind: 'form', reviewer: null, count: 7 },
        ],
        countLiveFacts: async () => 40,
        completenessByLevel: async () => [
          { levelRank: 1, entries: 2, complete: 1, sum: 1.5 },
          { levelRank: null, entries: 2, complete: 0, sum: 0.5 },
        ],
        pendingReview: async (before) => ({ count: 3, oldestAt: before, olderThan: 1 }),
        countOpenItems: async () => [open({ count: 4 }), open({ attempts: MAX_PASSES, count: 2 })],
        countTimedOutLeases: async () => 1,
      }),
    )
    const ticket = (id: string, status: TicketStatus): TicketRecord => ({
      id: id as TicketId,
      type: 'feedback',
      targetType: 'entry',
      target: entryId,
      message: 'Wrong.',
      status,
      resolutionNote: null,
      resolutionFactIds: [],
      revision: 0,
      createdAt: now,
      updatedAt: now,
    })
    world.tickets.push(ticket('a', 'open'), ticket('b', 'open'), ticket('c', 'dismissed'))
    const stats = await getConsoleStats(deps)
    expect(stats).toMatchObject({
      facts: [],
      live_facts: 40,
      completeness: { average: 0.5 },
      pending_review: { count: 3, oldest_at: '2026-11-11T04:30:00.000Z', over_one_hour: 1 },
      tickets: { open: 2, resolved: 0, dismissed: 1 },
      work: { open: 6, stuck: 2, timed_out_24h: 1 },
    })
    expect(stats.low_credibility).toEqual([
      { kind: 'senses', count: 3 },
      { kind: 'relation', count: 3 },
    ])
    expect(stats.completeness.by_level[0]).toEqual({ level: 'A1', entries: 2, complete: 1, average: 0.75 })
    expect(stats.completeness.by_level[1]).toEqual({ level: 'A2', entries: 0, complete: 0, average: 0 })
    expect(stats.completeness.by_level[6]).toEqual({ level: null, entries: 2, complete: 0, average: 0.25 })

    const empty = depsWith(
      monitorOf({
        countByCredibility: async () => [],
        countLiveFacts: async () => 0,
        completenessByLevel: async () => [],
        pendingReview: async () => ({ count: 0, oldestAt: null, olderThan: 0 }),
        countOpenItems: async () => [],
        countTimedOutLeases: async () => 0,
      }),
    )
    expect((await getConsoleStats(empty.deps)).completeness.average).toBe(0)
  })
})

describe('work summary', () => {
  it('counts open items by status and type, buckets the flow, and projects the backlog [spec: monitor/work-summary]', async () => {
    const lease = {
      id: '00000000-0000-4000-8000-000000000005' as WorkLeaseId,
      holder,
      type: 'syllables' as const,
      entryIds: [entryId],
      itemIds: [itemId, itemId],
      claimedAt: '2026-11-11T05:00:00.000Z',
      lemmas: ['dawn' as Lemma],
    }
    const flows: Record<string, Awaited<ReturnType<MonitorRepo['itemFlow']>>> = {
      '2026-11-10T06:00:00.000Z': [{ type: 'syllables', levelRank: 1, created: 4, closed: 3 }],
      '2026-11-04T05:30:00.000Z': [
        { type: 'syllables', levelRank: 1, created: 10, closed: 17 },
        { type: 'examples', levelRank: null, created: 7, closed: 0 },
      ],
      '2026-11-10T05:30:00.000Z': [{ type: 'syllables', levelRank: 1, created: 4, closed: 6 }],
    }
    const { deps } = depsWith(
      monitorOf({
        countOpenItems: async () => [
          open({ count: 2 }),
          open({ leased: true }),
          open({ awaiting: true, levelRank: null }),
          open({ type: 'examples', attempts: MAX_PASSES, levelRank: null }),
        ],
        itemFlow: async (since) => flows[since]!,
        throughput: async (_since, keyLength) => [{ key: '2026-11-11T05'.slice(0, keyLength), created: 4, closed: 3 }],
        medianCloseSeconds: async () => 600,
        attemptStats: async () => [
          { type: 'syllables', medianSeconds: 90, settled: 4, succeeded: 3 },
          { type: 'examples', medianSeconds: 30, settled: 0, succeeded: 0 },
        ],
        listLeases: async () => [
          { ...lease, expiresAt: '2026-11-11T06:00:00.000Z' },
          { ...lease, expiresAt: '2026-11-11T05:15:00.000Z' },
        ],
        countHolders: async () => 1,
        historySince: async () => '2026-11-01T00:00:00.000Z',
      }),
    )
    const summary = await getWorkSummary(deps, '24h')
    expect(summary).toMatchObject({
      window: '24h',
      history_since: '2026-11-01T00:00:00.000Z',
      open: { queued: 2, in_progress: 1, waiting_on_review: 1, stuck: 1, total: 5 },
      created: 4,
      closed: 3,
      median_close_seconds: 600,
      agents: 1,
      forecast: { net_per_day: 0, net_per_day_24h: 2 },
    })
    expect(summary.throughput).toHaveLength(24)
    expect(summary.throughput.at(-1)).toEqual({ start: '2026-11-11T05:00:00.000Z', created: 4, closed: 3 })
    expect(summary.by_type.find((row) => row.type === 'syllables')).toEqual({
      type: 'syllables',
      stage: 4,
      open: 4,
      waiting_on_review: 1,
      stuck: 0,
      closed: 3,
      median_attempt_seconds: 90,
      success_rate: 0.75,
    })
    expect(summary.by_type.find((row) => row.type === 'examples')).toMatchObject({
      stuck: 1,
      median_attempt_seconds: 30,
      success_rate: null,
    })
    expect(summary.by_type.find((row) => row.type === 'senses')).toMatchObject({
      open: 0,
      median_attempt_seconds: null,
      success_rate: null,
    })
    expect(summary.forecast.by_level[0]).toEqual({ level: 'A1', open: 3, net_per_day: 1 })
    expect(summary.forecast.by_level[6]).toEqual({ level: null, open: 2, net_per_day: -1 })
    expect(summary.leases.map((row) => [row.items, row.timed_out])).toEqual([
      [2, false],
      [2, true],
    ])
  })

  it('averages the backlog trend over the recorded history and reports none before a whole day [spec: monitor/work-summary]', async () => {
    const flow: Awaited<ReturnType<MonitorRepo['itemFlow']>> = [
      { type: 'syllables', levelRank: 1, created: 2, closed: 8 },
    ]
    const summaryOf = (historySince: string | null) => {
      const { deps } = depsWith(
        monitorOf({
          countOpenItems: async () => [open({ count: 2 })],
          itemFlow: async () => flow,
          throughput: async () => [],
          medianCloseSeconds: async () => null,
          attemptStats: async () => [],
          listLeases: async () => [],
          countHolders: async () => 0,
          historySince: async () => historySince,
        }),
      )
      return getWorkSummary(deps, '24h')
    }
    const young = await summaryOf('2026-11-11T00:00:00.000Z')
    expect(young.forecast).toMatchObject({ net_per_day: null, net_per_day_24h: null })
    expect(young.forecast.by_level[0]).toMatchObject({ level: 'A1', net_per_day: null })
    expect((await summaryOf(null)).forecast.net_per_day).toBeNull()
    const twoDays = await summaryOf('2026-11-09T05:30:00.000Z')
    expect(twoDays.forecast).toMatchObject({ net_per_day: 3, net_per_day_24h: 6 })
    expect(twoDays.forecast.by_level[0]).toMatchObject({ level: 'A1', net_per_day: 3 })
  })
})

describe('work items and attempts', () => {
  it('lists attempts with a one-line summary of each fact submitted [spec: monitor/attempts]', async () => {
    const { deps } = depsWith(monitorOf({ listAttempts: async () => ({ items: [attempt()], nextCursor: 'next' }) }))
    const page = await listWorkAttempts(deps, { outcome: 'waiting_on_review' }, { limit: 1 })
    expect(page).toEqual({
      items: [
        {
          id: '00000000-0000-4000-8000-000000000004',
          item_id: itemId,
          attempt: 1,
          entry: { id: entryId, lemma: 'dawn' },
          type: 'syllables',
          subject_id: entryId,
          sense_gloss: null,
          holder,
          claimed_at: '2026-11-11T05:10:00.000Z',
          completed_at: '2026-11-11T05:12:00.000Z',
          seconds: 120,
          outcome: 'waiting_on_review',
          note: null,
          facts: [{ id: syllables.id, kind: 'syllables', status: 'pending', summary: 'dawn' }],
        },
      ],
      nextCursor: 'next',
    })
  })

  it('says where each open item stands, and times an item from its creation to its first claim [spec: monitor/items]', async () => {
    const leased = item({ lease: { holder, expiresAt: '2026-11-11T06:00:00.000Z' } })
    const lapsed = item({ awaiting: true, lease: { holder, expiresAt: '2026-11-11T05:00:00.000Z' } })
    const { deps } = depsWith(
      monitorOf({
        listOpenItems: async () => [leased, lapsed],
        findItem: async (id) => (id === itemId ? leased : null),
        listItemAttempts: async () => [
          attempt({ id: 'second', ordinal: 2, claimedAt: '2026-11-11T05:20:00.000Z', seconds: 30 }),
          attempt({ outcome: 'no_progress' }),
        ],
      }),
    )
    const items = await listOpenWorkItems(deps, { entryId })
    expect(items.map((row) => [row.status, row.lease])).toEqual([
      ['in_progress', { holder, expires_at: '2026-11-11T06:00:00.000Z' }],
      ['waiting_on_review', null],
    ])
    expect(items[0]).toMatchObject({ stage: 4, entry: { id: entryId, lemma: 'dawn' }, closed_at: null })
    const detail = await getWorkItem(deps, itemId)
    expect(detail).toMatchObject({ status: 'in_progress', agent_seconds: 150, queue_seconds: 600 })
    expect(detail.attempts.map((row) => [row.id, row.attempt])).toEqual([
      ['second', 2],
      ['00000000-0000-4000-8000-000000000004', 1],
    ])
    await expect(getWorkItem(deps, crypto.randomUUID() as WorkItemId)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('reads a closed item from its history, timing an unclaimed one until it closed or until now [spec: monitor/items]', async () => {
    const closed = item({ closedAt: '2026-11-11T05:05:00.000Z' })
    const waiting = { ...item(), createdAt: '2026-11-11T05:29:00.000Z' }
    const { deps } = depsWith(
      monitorOf({
        findItem: async (id) => (id === itemId ? closed : waiting),
        listItemAttempts: async () => [],
      }),
    )
    expect(await getWorkItem(deps, itemId)).toMatchObject({
      status: 'closed',
      closed_at: '2026-11-11T05:05:00.000Z',
      attempts: [],
      agent_seconds: 0,
      queue_seconds: 300,
    })
    expect(await getWorkItem(deps, crypto.randomUUID() as WorkItemId)).toMatchObject({
      status: 'queued',
      queue_seconds: 60,
    })
  })
})
