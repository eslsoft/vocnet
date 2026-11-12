import { describe, expect, it } from 'vitest'
import { createConcurrencyLimit } from './concurrency'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('createConcurrencyLimit', () => {
  it('runs at most max calls at once, the rest in arrival order, and never more after a release', async () => {
    const limit = createConcurrencyLimit(2)
    let running = 0
    let peak = 0
    const started: number[] = []
    const gates = [deferred(), deferred(), deferred(), deferred()]
    const calls = gates.map((gate, at) =>
      limit(async () => {
        running += 1
        peak = Math.max(peak, running)
        started.push(at)
        await gate.promise
        running -= 1
        return at
      }),
    )
    await Promise.resolve()
    expect(started).toEqual([0, 1])
    gates[0]?.resolve()
    // A caller arriving while the slot is handed over waits behind the queued ones.
    const late = limit(async () => {
      started.push(4)
      return 4
    })
    gates[1]?.resolve()
    gates[2]?.resolve()
    gates[3]?.resolve()
    await expect(Promise.all([...calls, late])).resolves.toEqual([0, 1, 2, 3, 4])
    expect(peak).toBe(2)
    expect(started).toEqual([0, 1, 2, 3, 4])
  })

  it('frees the slot of a call that fails', async () => {
    const limit = createConcurrencyLimit(1)
    await expect(limit(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(limit(async () => 'next')).resolves.toBe('next')
  })
})
