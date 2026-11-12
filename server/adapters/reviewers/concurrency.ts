/** Runs a call once a slot is free. */
export type ConcurrencyLimit = <T>(call: () => Promise<T>) => Promise<T>

/**
 * At most `max` calls run at once; the rest wait their turn, first come first served. A finished
 * call hands its slot straight to the next waiter, so a caller arriving in between cannot take it
 * and push the count past `max`.
 */
export function createConcurrencyLimit(max: number): ConcurrencyLimit {
  let running = 0
  const waiting: Array<() => void> = []
  const acquire = () => {
    if (running < max) {
      running += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => waiting.push(resolve))
  }
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else running -= 1
  }
  return async (call) => {
    await acquire()
    try {
      return await call()
    } finally {
      release()
    }
  }
}

const limits = new Map<string, ConcurrencyLimit>()

/**
 * The limit named `name`, shared by every request this isolate serves: the deps are built per
 * request, while the gateway's rate limit counts calls across all of them. A changed `max` takes
 * effect on restart.
 */
export function sharedConcurrencyLimit(name: string, max: number): ConcurrencyLimit {
  const existing = limits.get(name)
  if (existing) return existing
  const limit = createConcurrencyLimit(max)
  limits.set(name, limit)
  return limit
}
