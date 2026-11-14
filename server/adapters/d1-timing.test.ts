import { afterEach, describe, expect, it, vi } from 'vitest'
import { SLOW_QUERY_MS, timedD1 } from './d1-timing'

function fakeD1(delayMs: number) {
  const batched: unknown[][] = []
  const statement = (sql: string, bound: unknown[] = []) => ({
    sql,
    bound,
    bind: (...args: unknown[]) => statement(sql, args),
    all: async () => {
      await vi.advanceTimersByTimeAsync(delayMs)
      return { results: [sql, ...bound] }
    },
    first: async () => sql,
  })
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: unknown[]) => {
      batched.push(statements)
      await vi.advanceTimersByTimeAsync(delayMs)
      return statements.map(() => ({ results: [] }))
    },
    exec: async () => ({ count: 0, duration: 0 }),
  }
  return { db: db as unknown as D1Database, batched }
}

describe('timedD1', () => {
  afterEach(() => vi.useRealTimers())

  it('logs a statement that runs past the slow threshold, with its SQL, and keeps its result', async () => {
    vi.useFakeTimers()
    const { db } = fakeD1(SLOW_QUERY_MS + 10)
    const log = vi.fn()
    const timed = timedD1(db, log)
    const result = await timed.prepare('select * from facts where id = ?').bind('f1').all()
    expect(result).toEqual({ results: ['select * from facts where id = ?', 'f1'] })
    expect(log).toHaveBeenCalledWith({
      event: 'slow_query',
      ms: expect.any(Number),
      sql: 'select * from facts where id = ?',
    })
  })

  it('does not log a fast statement', async () => {
    vi.useFakeTimers()
    const { db } = fakeD1(1)
    const log = vi.fn()
    expect(await timedD1(db, log).prepare('select 1').first()).toBe('select 1')
    expect(log).not.toHaveBeenCalled()
  })

  it('hands the original statements to a batch and logs a slow batch with every statement', async () => {
    vi.useFakeTimers()
    const { db, batched } = fakeD1(SLOW_QUERY_MS)
    const log = vi.fn()
    const timed = timedD1(db, log)
    await timed.batch([timed.prepare('update a set x = 1'), timed.prepare('update b set y = 2')])
    // The binding receives its own statements, not the wrappers.
    expect((batched[0] as Array<{ sql: string }>).map((statement) => statement.sql)).toEqual([
      'update a set x = 1',
      'update b set y = 2',
    ])
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ sql: 'batch: update a set x = 1 ; update b set y = 2' }))
  })
})
