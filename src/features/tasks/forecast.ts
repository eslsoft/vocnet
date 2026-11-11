import type { WorkSummary } from '@shared/monitor'
import type { CefrLevel } from '@shared/reference'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const HOURS: Record<WorkSummary['window'], number> = { '24h': 24, '7d': 168 }

/**
 * Days until `open` tasks are gone at a net closing rate (closed minus created per day); null
 * while the queue is not shrinking.
 */
export function daysToClear(open: number, netPerDay: number): number | null {
  if (open === 0) return 0
  return netPerDay > 0 ? open / netPerDay : null
}

/** A forecast whose rates are known: the server reports every rate or, before a day of history, none. */
export type KnownForecast = {
  net_per_day: number
  net_per_day_24h: number
  by_level: Array<{ level: CefrLevel | null; open: number; net_per_day: number }>
}

/** The forecast with its rates; null while the history is younger than a day and nothing can be forecast. */
export function knownForecast(forecast: WorkSummary['forecast']): KnownForecast | null {
  return forecast.net_per_day === null ? null : (forecast as KnownForecast)
}

/** The finish date range the 7-day and the 24-hour rates give, with the 7-day estimate as the headline. */
export function clearRange(
  open: number,
  forecast: Pick<KnownForecast, 'net_per_day' | 'net_per_day_24h'>,
  now: number,
): { days: number; from: Date; to: Date } | null {
  const estimates = [daysToClear(open, forecast.net_per_day), daysToClear(open, forecast.net_per_day_24h)]
  const known = estimates.filter((days): days is number => days !== null)
  if (known.length === 0) return null
  const at = (days: number) => new Date(now + days * DAY_MS)
  return { days: estimates[0] ?? Math.min(...known), from: at(Math.min(...known)), to: at(Math.max(...known)) }
}

/**
 * Per-hour rates over the recorded part of the window. The net is the change in open tasks:
 * negative while it shrinks. Null before the history records anything.
 */
export function hourlyRates(
  summary: Pick<WorkSummary, 'window' | 'closed' | 'created' | 'agents' | 'history_since'>,
  now: number,
) {
  if (summary.history_since === null) return null
  const recorded = (now - new Date(summary.history_since).getTime()) / HOUR_MS
  const hours = Math.max(1, Math.min(HOURS[summary.window], recorded))
  const closed = summary.closed / hours
  return {
    closed,
    created: summary.created / hours,
    net: (summary.created - summary.closed) / hours,
    perAgent: summary.agents > 0 ? closed / summary.agents : null,
  }
}

const LEVEL_ORDER: Array<CefrLevel | null> = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', null]

/** Level rows in CEFR order, the entries without a level last. */
export function inLevelOrder<T extends { level: CefrLevel | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level))
}

/** How much of a lease's time is left, from 1 at its claim to 0 at its expiry. */
export function leaseRemaining(lease: { claimed_at: string; expires_at: string }, now: number): number {
  const start = new Date(lease.claimed_at).getTime()
  const end = new Date(lease.expires_at).getTime()
  if (end <= start) return 0
  return Math.min(1, Math.max(0, (end - now) / (end - start)))
}
