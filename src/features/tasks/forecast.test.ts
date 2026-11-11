import { describe, expect, it } from 'vitest'
import { clearRange, daysToClear, hourlyRates, inLevelOrder, knownForecast, leaseRemaining } from './forecast'

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
    const range = clearRange(100, { net_per_day: 10, net_per_day_24h: 20 }, now)
    expect(range?.days).toBe(10)
    expect(range?.from.getTime()).toBe(now + 5 * DAY)
    expect(range?.to.getTime()).toBe(now + 10 * DAY)
    const recent = clearRange(100, { net_per_day: -1, net_per_day_24h: 50 }, now)
    expect(recent?.days).toBe(2)
    expect(clearRange(100, { net_per_day: -1, net_per_day_24h: 0 }, now)).toBeNull()
  })

  it('rates the recorded part of the window per hour, the net as the change in open tasks', () => {
    const now = Date.UTC(2026, 10, 10)
    const long = new Date(now - 30 * DAY).toISOString()
    expect(hourlyRates({ window: '24h', closed: 48, created: 24, agents: 2, history_since: long }, now)).toEqual({
      closed: 2,
      created: 1,
      net: -1,
      perAgent: 1,
    })
    expect(hourlyRates({ window: '7d', closed: 168, created: 336, agents: 0, history_since: long }, now)).toEqual({
      closed: 1,
      created: 2,
      net: 1,
      perAgent: null,
    })
    const sixHours = new Date(now - 6 * 3_600_000).toISOString()
    expect(hourlyRates({ window: '24h', closed: 12, created: 6, agents: 1, history_since: sixHours }, now)).toEqual({
      closed: 2,
      created: 1,
      net: -1,
      perAgent: 2,
    })
    expect(hourlyRates({ window: '24h', closed: 0, created: 0, agents: 0, history_since: null }, now)).toBeNull()
  })

  it('collects history until the server reports the rates', () => {
    expect(knownForecast({ net_per_day: null, net_per_day_24h: null, by_level: [] })).toBeNull()
    const known = { net_per_day: 3, net_per_day_24h: 2, by_level: [{ level: 'A1' as const, open: 1, net_per_day: 1 }] }
    expect(knownForecast(known)).toBe(known)
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
