/** Runs a call once a slot is free. */
export type ConcurrencyLimit = <T>(call: () => Promise<T>) => Promise<T>

/**
 * At most `max` calls run at once; the rest wait their turn, first come first served. A finished
 * call hands its slot straight to the next waiter, so a caller arriving in between cannot take it
 * and push the count past `max`. A limit belongs to one request (one review batch): the Workers
 * runtime cancels a continuation that another request's promise resolves, so it cannot be shared
 * across requests.
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
