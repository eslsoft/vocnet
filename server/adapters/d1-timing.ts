/** A statement at or past this many milliseconds is logged as slow. */
export const SLOW_QUERY_MS = 500

type Log = (entry: { event: 'slow_query'; ms: number; sql: string; rows?: number }) => void

const EXECUTE = new Set(['first', 'run', 'all', 'raw'])

/**
 * Wraps a D1 binding so every statement that takes SLOW_QUERY_MS or longer is logged with its
 * duration and SQL. D1 runs one statement at a time, so a slow statement delays every request
 * behind it; the log names the statements that do. A batch is timed as a whole and logged with
 * the SQL of its statements.
 */
export function timedD1(db: D1Database, log: Log = (entry) => console.warn(JSON.stringify(entry))): D1Database {
  const originals = new WeakMap<object, D1PreparedStatement>()
  const sqlOf = new WeakMap<object, string>()
  const report = (started: number, sql: string) => {
    const ms = Date.now() - started
    if (ms >= SLOW_QUERY_MS) log({ event: 'slow_query', ms, sql: sql.slice(0, 600) })
  }
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver)
        if (typeof value !== 'function') return value
        if (prop === 'bind') return (...args: unknown[]) => wrap(value.apply(target, args), sql)
        if (typeof prop === 'string' && EXECUTE.has(prop)) {
          return async (...args: unknown[]) => {
            const started = Date.now()
            try {
              return await value.apply(target, args)
            } finally {
              report(started, sql)
            }
          }
        }
        return value.bind(target)
      },
    })
    originals.set(proxy, statement)
    sqlOf.set(proxy, sql)
    return proxy
  }
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql)
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          const started = Date.now()
          try {
            return await target.batch(statements.map((statement) => originals.get(statement) ?? statement))
          } finally {
            report(started, `batch: ${statements.map((statement) => sqlOf.get(statement) ?? '?').join(' ; ')}`)
          }
        }
      }
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
