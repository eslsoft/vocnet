import { describe, expect, it } from 'vitest'
import {
  before,
  fillBuckets,
  levelOfRank,
  ONE_HOUR_MS,
  openItemStatus,
  REPORTED_LEVELS,
  rankOfLevel,
  secondsBetween,
  windowBuckets,
} from './monitor'
import { MAX_ATTEMPTS } from './work'

describe('open item status', () => {
  it('puts an item at the attempt bound with the curators, then a leased one in progress, then one awaiting review [spec: monitor/item-status]', () => {
    const item = { attempts: 0, awaiting: false, leased: false }
    expect(openItemStatus(item)).toBe('queued')
    expect(openItemStatus({ ...item, awaiting: true })).toBe('waiting_on_review')
    expect(openItemStatus({ ...item, awaiting: true, leased: true })).toBe('in_progress')
    expect(openItemStatus({ ...item, attempts: MAX_ATTEMPTS, leased: true })).toBe('stuck')
  })
})

describe('summary windows', () => {
  const now = new Date('2026-11-11T05:42:10.000Z')

  it('buckets 24 hours ending with the current hour, or 7 days ending with the current day [spec: monitor/throughput-buckets]', () => {
    const day = windowBuckets('24h', now)
    expect(day.starts).toHaveLength(24)
    expect(day.since).toBe('2026-11-10T06:00:00.000Z')
    expect(day.starts.at(-1)).toBe('2026-11-11T05:00:00.000Z')
    const week = windowBuckets('7d', now)
    expect(week.starts).toEqual([
      '2026-11-05T00:00:00.000Z',
      '2026-11-06T00:00:00.000Z',
      '2026-11-07T00:00:00.000Z',
      '2026-11-08T00:00:00.000Z',
      '2026-11-09T00:00:00.000Z',
      '2026-11-10T00:00:00.000Z',
      '2026-11-11T00:00:00.000Z',
    ])
    // A row is keyed by its timestamp's hour or day prefix; a bucket without one counts nothing.
    const filled = fillBuckets(week, [{ key: '2026-11-11', created: 3, closed: 1 }])
    expect(filled.at(-1)).toEqual({ start: '2026-11-11T00:00:00.000Z', created: 3, closed: 1 })
    expect(filled[0]).toEqual({ start: '2026-11-05T00:00:00.000Z', created: 0, closed: 0 })
    expect(fillBuckets(day, [{ key: '2026-11-11T05', created: 2, closed: 0 }]).at(-1)).toMatchObject({ created: 2 })
  })

  it('reports by CEFR level from A1 to C2, then without one, and measures spans in seconds', () => {
    expect(REPORTED_LEVELS).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', null])
    expect(REPORTED_LEVELS.map(rankOfLevel)).toEqual([1, 2, 3, 4, 5, 6, null])
    expect([1, 6, null].map(levelOfRank)).toEqual(['A1', 'C2', null])
    expect(() => levelOfRank(7)).toThrow()
    expect(before(now, ONE_HOUR_MS)).toBe('2026-11-11T04:42:10.000Z')
    expect(secondsBetween('2026-11-11T05:00:00.000Z', '2026-11-11T05:01:30.000Z')).toBe(90)
  })
})
