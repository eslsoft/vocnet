import type { Stats } from '@shared/catalog'
import { type FactKind, type FactStatus, factKindSchema, factStatusSchema } from '@shared/facts'

export interface StatsGrid {
  rows: Array<{ kind: FactKind; counts: Record<FactStatus, number>; total: number }>
  totals: Record<FactStatus, number>
  total: number
}

const zeroes = () =>
  Object.fromEntries(factStatusSchema.options.map((status) => [status, 0])) as Record<FactStatus, number>

/** The sparse count list as a full kind × status grid, zero-filled, in vocabulary order. */
export function statsGrid(stats: Stats): StatsGrid {
  const rows = factKindSchema.options.map((kind) => {
    const counts = zeroes()
    for (const cell of stats.facts) if (cell.kind === kind) counts[cell.status] = cell.count
    return { kind, counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) }
  })
  const totals = zeroes()
  for (const row of rows) for (const status of factStatusSchema.options) totals[status] += row.counts[status]
  return { rows, totals, total: rows.reduce((sum, row) => sum + row.total, 0) }
}
