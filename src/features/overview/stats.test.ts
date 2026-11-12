import { describe, expect, it } from 'vitest'
import { consoleStats } from '@/test/console-api'
import { entryTotal, factTypeRows, lowCredibilityTotal } from './stats'

describe('overview stats', () => {
  it('splits each kind into credible, low-credibility, pending, and rejected, largest first', () => {
    const stats = consoleStats({
      facts: [
        { kind: 'example', status: 'published', count: 10 },
        { kind: 'example', status: 'pending', count: 2 },
        { kind: 'example', status: 'superseded', count: 7 },
        { kind: 'senses', status: 'published', count: 20 },
        { kind: 'senses', status: 'rejected', count: 1 },
        { kind: 'topic', status: 'retracted', count: 3 },
      ],
      low_credibility: [{ kind: 'example', count: 3 }],
    })
    expect(factTypeRows(stats)).toEqual([
      { kind: 'senses', published: 20, low: 0, pending: 0, rejected: 1, total: 21 },
      { kind: 'example', published: 7, low: 3, pending: 2, rejected: 0, total: 12 },
    ])
    expect(lowCredibilityTotal(stats)).toBe(3)
  })

  it('counts entries across levels', () => {
    const stats = consoleStats({
      completeness: {
        average: 0.5,
        by_level: [
          { level: 'A1', entries: 3, complete: 1, average: 0.5 },
          { level: null, entries: 4, complete: 0, average: 0.1 },
        ],
      },
    })
    expect(entryTotal(stats)).toBe(7)
  })
})
