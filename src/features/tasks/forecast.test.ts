import { describe, expect, it } from 'vitest'
import { clearRange, daysToClear, hourlyRates, inLevelOrder, leaseRemaining } from './forecast'

const DAY = 86_400_000

describe('forecast', () => {
  it('counts the days to clear a shrinking queue and none for a growing one', () => {
    expect(daysToClear(100, 10)).toBe(10)
    expect(daysToClear(0, -5)).toBe(0)
    expect(daysToClear(100, 0)).toBeNull()
    expect(daysToClear(100, -3)).toBeNull()
  })

  it('ranges the finish date over the 7-day and 24-hour rates, headlining the 7-day one', () => {
    const now = Date.UTC(2026, 10, 10)
    const range = clearRange(100, { net_per_day: 10, net_per_day_24h: 20, by_level: [] }, now)
    expect(range?.days).toBe(10)
    expect(range?.from.getTime()).toBe(now + 5 * DAY)
    expect(range?.to.getTime()).toBe(now + 10 * DAY)
    const recent = clearRange(100, { net_per_day: -1, net_per_day_24h: 50, by_level: [] }, now)
    expect(recent?.days).toBe(2)
    expect(clearRange(100, { net_per_day: -1, net_per_day_24h: 0, by_level: [] }, now)).toBeNull()
  })

  it('rates the window per hour, the net as the change in open tasks', () => {
    expect(hourlyRates({ window: '24h', closed: 48, created: 24, agents: 2 })).toEqual({
      closed: 2,
      created: 1,
      net: -1,
      perAgent: 1,
    })
    expect(hourlyRates({ window: '7d', closed: 168, created: 336, agents: 0 })).toEqual({
      closed: 1,
      created: 2,
      net: 1,
      perAgent: null,
    })
  })

  it('orders levels by CEFR with the unlevelled last', () => {
    const rows = [{ level: null }, { level: 'B1' as const }, { level: 'A1' as const }]
    expect(inLevelOrder(rows).map((row) => row.level)).toEqual(['A1', 'B1', null])
  })

  it('measures the share of a lease left', () => {
    const lease = { claimed_at: '2026-11-10T10:00:00.000Z', expires_at: '2026-11-10T10:10:00.000Z' }
    expect(leaseRemaining(lease, Date.parse('2026-11-10T10:05:00.000Z'))).toBe(0.5)
    expect(leaseRemaining(lease, Date.parse('2026-11-10T10:20:00.000Z'))).toBe(0)
    expect(leaseRemaining(lease, Date.parse('2026-11-10T09:00:00.000Z'))).toBe(1)
    expect(leaseRemaining({ ...lease, expires_at: lease.claimed_at }, 0)).toBe(0)
  })
})
