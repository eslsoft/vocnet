import { summarizeFact } from '@server/domain/fact-kinds'
import {
  before,
  FORECAST_DAYS,
  fillBuckets,
  levelOfRank,
  ONE_DAY_MS,
  ONE_HOUR_MS,
  type OpenItemStatus,
  openItemStatus,
  REPORTED_LEVELS,
  rankOfLevel,
  secondsBetween,
  windowBuckets,
} from '@server/domain/monitor'
import { MAX_ATTEMPTS, WORK_POLICY } from '@server/domain/work'
import type { EntryId } from '@shared/facts'
import type {
  ConsoleStats,
  WorkAttemptDto,
  WorkItemDetail,
  WorkItemOverview,
  WorkOpenCounts,
  WorkSummary,
  WorkWindow,
} from '@shared/monitor'
import type { WorkItemId, WorkType } from '@shared/work'
import type { Deps } from './deps'
import { NotFoundError } from './errors'
import type { Page, PageRequest, WorkAttemptFilter, WorkAttemptRecord, WorkItemRecord } from './ports'

// The console's read-only views of the dictionary and its work. Every number derives from stored
// rows on read; nothing here writes.

/** How many leases the work summary lists at most. */
export const SUMMARY_LEASES = 100

/** Fact, completeness, review, feedback, and work counts for the console's overview. */
export async function getConsoleStats(
  deps: Pick<Deps, 'facts' | 'feedback' | 'monitor' | 'clock'>,
): Promise<ConsoleStats> {
  const now = deps.clock.now()
  const [facts, flagged, liveFacts, levels, pending, feedback, open, timedOut] = await Promise.all([
    deps.facts.countByKindAndStatus(),
    deps.monitor.countWeakByKind(),
    deps.monitor.countLiveFacts(),
    deps.monitor.completenessByLevel(),
    deps.monitor.pendingReview(before(now, ONE_HOUR_MS)),
    deps.feedback.countByStatus(),
    deps.monitor.countOpenItems(now.toISOString()),
    deps.monitor.countTimedOutLeases(before(now, ONE_DAY_MS), now.toISOString()),
  ])
  const byLevel = REPORTED_LEVELS.map((level) => {
    const row = levels.find((candidate) => levelOfRank(candidate.levelRank) === level)
    const entries = row?.entries ?? 0
    return { level, entries, complete: row?.complete ?? 0, average: entries === 0 ? 0 : (row?.sum ?? 0) / entries }
  })
  const entries = byLevel.reduce((sum, level) => sum + level.entries, 0)
  const sum = levels.reduce((total, level) => total + level.sum, 0)
  return {
    facts,
    flagged,
    live_facts: liveFacts,
    completeness: { average: entries === 0 ? 0 : sum / entries, by_level: byLevel },
    pending_review: { count: pending.count, oldest_at: pending.oldestAt, over_one_hour: pending.olderThan },
    feedback,
    work: {
      open: open.reduce((total, row) => total + row.count, 0),
      stuck: open.filter((row) => row.attempts >= MAX_ATTEMPTS).reduce((total, row) => total + row.count, 0),
      timed_out_24h: timedOut,
    },
  }
}

const emptyCounts = (): WorkOpenCounts => ({ queued: 0, in_progress: 0, waiting_on_review: 0, stuck: 0, total: 0 })

const tally = (counts: WorkOpenCounts, status: OpenItemStatus, count: number) => {
  counts[status] += count
  counts.total += count
}

/**
 * How fast the agents close the open work over the window: open items by status and type, items
 * created and closed per bucket, attempt times and success by type, the backlog's trend overall
 * and by level, and the leases of the last day.
 */
export async function getWorkSummary(deps: Pick<Deps, 'monitor' | 'clock'>, window: WorkWindow): Promise<WorkSummary> {
  const now = deps.clock.now()
  const at = now.toISOString()
  const buckets = windowBuckets(window, now)
  const [open, flow, week, day, throughput, medianClose, attempts, leases, agents, historySince] = await Promise.all([
    deps.monitor.countOpenItems(at),
    deps.monitor.itemFlow(buckets.since),
    deps.monitor.itemFlow(before(now, FORECAST_DAYS * ONE_DAY_MS)),
    deps.monitor.itemFlow(before(now, ONE_DAY_MS)),
    deps.monitor.throughput(buckets.since, buckets.keyLength),
    deps.monitor.medianCloseSeconds(buckets.since),
    deps.monitor.attemptStats(buckets.since),
    deps.monitor.listLeases(before(now, ONE_DAY_MS), SUMMARY_LEASES),
    deps.monitor.countHolders(at),
    deps.monitor.historySince(),
  ])
  const totals = emptyCounts()
  const byType = new Map<WorkType, WorkOpenCounts>()
  const openByLevel = new Map<number | null, number>()
  for (const row of open) {
    const status = openItemStatus(row)
    tally(totals, status, row.count)
    const counts = byType.get(row.type) ?? emptyCounts()
    tally(counts, status, row.count)
    byType.set(row.type, counts)
    openByLevel.set(row.levelRank, (openByLevel.get(row.levelRank) ?? 0) + row.count)
  }
  const net = (rows: typeof week) => rows.reduce((sum, row) => sum + row.closed - row.created, 0)
  // A rate is averaged over the recorded part of its span, and only once a whole day is recorded.
  const recordedDays = historySince === null ? 0 : (now.getTime() - Date.parse(historySince)) / ONE_DAY_MS
  const perDay = (rows: typeof week, spanDays: number) =>
    recordedDays < 1 ? null : net(rows) / Math.min(spanDays, recordedDays)
  const sumOf = (rows: typeof flow, field: 'created' | 'closed') => rows.reduce((sum, row) => sum + row[field], 0)
  const types = Object.keys(WORK_POLICY) as WorkType[]
  return {
    window,
    open: totals,
    history_since: historySince,
    created: sumOf(flow, 'created'),
    closed: sumOf(flow, 'closed'),
    median_close_seconds: medianClose,
    agents,
    by_type: types.map((type) => {
      const counts = byType.get(type) ?? emptyCounts()
      const tried = attempts.find((row) => row.type === type)
      return {
        type,
        stage: WORK_POLICY[type].stage,
        open: counts.total,
        waiting_on_review: counts.waiting_on_review,
        stuck: counts.stuck,
        closed: sumOf(
          flow.filter((row) => row.type === type),
          'closed',
        ),
        median_attempt_seconds: tried?.medianSeconds ?? null,
        success_rate: tried && tried.settled > 0 ? tried.succeeded / tried.settled : null,
      }
    }),
    throughput: fillBuckets(buckets, throughput),
    forecast: {
      net_per_day: perDay(week, FORECAST_DAYS),
      net_per_day_24h: perDay(day, 1),
      by_level: REPORTED_LEVELS.map((level) => {
        const rank = rankOfLevel(level)
        return {
          level,
          open: openByLevel.get(rank) ?? 0,
          net_per_day: perDay(
            week.filter((row) => row.levelRank === rank),
            FORECAST_DAYS,
          ),
        }
      }),
    },
    leases: leases.map((lease) => ({
      id: lease.id,
      holder: lease.holder,
      type: lease.type,
      items: lease.itemIds.length,
      lemmas: lease.lemmas,
      claimed_at: lease.claimedAt,
      expires_at: lease.expiresAt,
      timed_out: lease.expiresAt <= at,
    })),
  }
}

const attemptDto = (attempt: WorkAttemptRecord): WorkAttemptDto => ({
  id: attempt.id,
  item_id: attempt.itemId,
  attempt: attempt.ordinal,
  entry: { id: attempt.entryId, lemma: attempt.lemma },
  type: attempt.type,
  subject_id: attempt.subjectId,
  sense_gloss: attempt.senseGloss,
  holder: attempt.holder,
  claimed_at: attempt.claimedAt,
  completed_at: attempt.completedAt,
  seconds: attempt.seconds,
  outcome: attempt.outcome,
  note: attempt.note,
  facts: attempt.facts.map((fact) => ({
    id: fact.id,
    kind: fact.kind,
    status: fact.status,
    summary: summarizeFact(fact),
  })),
})

/** Completed attempts the filter admits, latest first, each with the facts its holder submitted. */
export async function listWorkAttempts(
  deps: Pick<Deps, 'monitor'>,
  filter: WorkAttemptFilter,
  page: PageRequest,
): Promise<Page<WorkAttemptDto>> {
  const found = await deps.monitor.listAttempts(filter, page)
  return { items: found.items.map(attemptDto), nextCursor: found.nextCursor }
}

function overviewDto(item: WorkItemRecord, now: string): WorkItemOverview {
  const leased = item.lease !== null && item.lease.expiresAt > now
  return {
    id: item.id,
    type: item.type,
    stage: WORK_POLICY[item.type].stage,
    entry: { id: item.entryId, lemma: item.lemma },
    subject_id: item.subjectId,
    sense_gloss: item.senseGloss,
    gap: item.gap,
    status: item.closedAt === null ? openItemStatus({ ...item, leased }) : 'closed',
    attempts_without_progress: item.attempts,
    lease: leased && item.lease ? { holder: item.lease.holder, expires_at: item.lease.expiresAt } : null,
    created_at: item.createdAt,
    closed_at: item.closedAt,
  }
}

/** The open items of an entry, or about one node, with where each stands. */
export async function listOpenWorkItems(
  deps: Pick<Deps, 'monitor' | 'clock'>,
  by: { entryId: EntryId } | { subjectId: string },
): Promise<WorkItemOverview[]> {
  const now = deps.clock.now().toISOString()
  return (await deps.monitor.listOpenItems(by)).map((item) => overviewDto(item, now))
}

/**
 * One item, open or closed, with every completed attempt at it, the agents' time on it, and how
 * long it waited for its first claim: until now while never claimed and open, until it closed
 * when it closed unclaimed.
 */
export async function getWorkItem(deps: Pick<Deps, 'monitor' | 'clock'>, id: WorkItemId): Promise<WorkItemDetail> {
  const now = deps.clock.now().toISOString()
  const [item, attempts] = await Promise.all([deps.monitor.findItem(id), deps.monitor.listItemAttempts(id)])
  if (!item) throw new NotFoundError(`Work item ${id} not found.`)
  const first = attempts.at(-1)
  return {
    ...overviewDto(item, now),
    attempts: attempts.map(attemptDto),
    agent_seconds: attempts.reduce((sum, attempt) => sum + attempt.seconds, 0),
    queue_seconds: secondsBetween(item.createdAt, first?.claimedAt ?? item.closedAt ?? now),
  }
}
