import type { WorkWindow } from '@shared/monitor'
import { type CefrLevel, cefrLevelSchema } from '@shared/reference'
import { levelRank } from './reference'
import { MAX_ATTEMPTS } from './work'

// The console's read-only view of the work: where each open item stands, and how the item history
// is bucketed and projected. Pure functions over stored rows.

/** Where an open item stands. */
export type OpenItemStatus = 'queued' | 'in_progress' | 'waiting_on_review' | 'stuck'

/**
 * An item at the attempt bound is stuck (with the curators); else one under an unexpired lease is
 * in progress, one a pending fact may change waits on review, and the rest are queued.
 */
export function openItemStatus(item: { attempts: number; awaiting: boolean; leased: boolean }): OpenItemStatus {
  if (item.attempts >= MAX_ATTEMPTS) return 'stuck'
  if (item.leased) return 'in_progress'
  return item.awaiting ? 'waiting_on_review' : 'queued'
}

/** The CEFR levels the console reports by, lowest first, then null for an entry without one. */
export const REPORTED_LEVELS: ReadonlyArray<CefrLevel | null> = [...cefrLevelSchema.options, null]

/** The CEFR level of a `levelRank`; null for none. */
export const levelOfRank = (rank: number | null): CefrLevel | null =>
  rank === null ? null : cefrLevelSchema.parse(cefrLevelSchema.options[rank - 1])

export const rankOfLevel = (level: CefrLevel | null): number | null => (level === null ? null : levelRank(level))

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/**
 * A summary window as throughput buckets: 24 hours ending with the current hour, or 7 days ending
 * with the current UTC day. `since` is the first bucket's start, from which every count "within
 * the window" runs; `keyLength` is how much of an ISO timestamp names its bucket (the hour or the day).
 */
export interface WindowBuckets {
  since: string
  starts: string[]
  keyLength: number
}

export function windowBuckets(window: WorkWindow, now: Date): WindowBuckets {
  const [size, count, keyLength] = window === '24h' ? [HOUR_MS, 24, 13] : [DAY_MS, 7, 10]
  const current = Math.floor(now.getTime() / size) * size
  const starts = Array.from({ length: count }, (_, at) => new Date(current - (count - 1 - at) * size).toISOString())
  return { since: starts[0]!, starts, keyLength }
}

/** The bucket counts by start, every bucket of the window present; `rows` are keyed by `keyLength` prefix. */
export function fillBuckets(
  buckets: WindowBuckets,
  rows: ReadonlyArray<{ key: string; created: number; closed: number }>,
): Array<{ start: string; created: number; closed: number }> {
  const byKey = new Map(rows.map((row) => [row.key, row]))
  return buckets.starts.map((start) => {
    const row = byKey.get(start.slice(0, buckets.keyLength))
    return { start, created: row?.created ?? 0, closed: row?.closed ?? 0 }
  })
}

/** The instant this many milliseconds before `now`. */
export const before = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString()

export const ONE_HOUR_MS = HOUR_MS
export const ONE_DAY_MS = DAY_MS
export const FORECAST_DAYS = 7

/** Seconds from one instant to another. */
export const secondsBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 1000
