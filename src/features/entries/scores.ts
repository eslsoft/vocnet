import type { managedEntrySchema } from '@shared/catalog'
import type { FactDto } from '@shared/facts'
import type { WorkItemOverview, WorkItemStatus } from '@shared/monitor'
import type { z } from 'zod'

type ManagedEntry = z.infer<typeof managedEntrySchema>

/** Below this credibility, a fact of its kind and review path is wrong more than one time in ten: audits look here first. */
export const CREDIBILITY_WATCH = 0.9

/** Open tasks by where they stand, in the order the bar shows them. */
export function taskCounts(tasks: readonly WorkItemOverview[]): Record<Exclude<WorkItemStatus, 'closed'>, number> {
  const count = (status: WorkItemStatus) => tasks.filter((task) => task.status === status).length
  return {
    queued: count('queued'),
    in_progress: count('in_progress'),
    waiting_on_review: count('waiting_on_review'),
    stuck: count('stuck'),
  }
}

/** The fact last changed, which tells when and by whom the entry was last updated. */
export function lastChange(view: ManagedEntry): FactDto | null {
  return view.facts.reduce<FactDto | null>(
    (latest, fact) => (latest === null || fact.updated_at > latest.updated_at ? fact : latest),
    null,
  )
}
