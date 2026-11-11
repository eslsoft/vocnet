import type { FactKind } from '@shared/facts'
import type { ConsoleStats } from '@shared/monitor'

export interface FactTypeRow {
  kind: FactKind
  /** Published and not flagged. */
  published: number
  flagged: number
  pending: number
  rejected: number
  total: number
}

/** Each kind's current facts by how an admin reads them, the largest kind first; kinds with none are left out. */
export function factTypeRows(stats: ConsoleStats): FactTypeRow[] {
  const count = (kind: FactKind, status: string) =>
    stats.facts.find((cell) => cell.kind === kind && cell.status === status)?.count ?? 0
  const kinds = [...new Set(stats.facts.map((cell) => cell.kind))]
  return kinds
    .map((kind) => {
      const flagged = stats.flagged.find((cell) => cell.kind === kind)?.count ?? 0
      const published = count(kind, 'published')
      const pending = count(kind, 'pending')
      const rejected = count(kind, 'rejected')
      return {
        kind,
        published: Math.max(0, published - flagged),
        flagged,
        pending,
        rejected,
        total: published + pending + rejected,
      }
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)
}

export const flaggedTotal = (stats: ConsoleStats) => stats.flagged.reduce((sum, cell) => sum + cell.count, 0)

export const entryTotal = (stats: ConsoleStats) =>
  stats.completeness.by_level.reduce((sum, level) => sum + level.entries, 0)

/** Above this, a pending fact has waited longer than review normally takes. */
export const REVIEW_SLA_MS = 3_600_000
