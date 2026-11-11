import type { managedEntrySchema } from '@shared/catalog'
import type { FactDto } from '@shared/facts'
import type { WorkItemOverview, WorkItemStatus } from '@shared/monitor'
import type { z } from 'zod'

type ManagedEntry = z.infer<typeof managedEntrySchema>

/** Below this quality, an entry has enough flagged facts to deserve a look. */
export const QUALITY_WATCH = 0.97

const isLive = (fact: FactDto) => fact.status === 'pending' || fact.status === 'published'
const isFlawed = (fact: FactDto) =>
  fact.status === 'published' && fact.review !== null && fact.review.verdict !== 'pass'

/** The live facts about the entry and its senses (not relations pointing in), and how many have a flaw. */
export function factHealth(view: ManagedEntry): { live: number; flagged: number } {
  const own = new Set<string>([view.entry.id, ...view.senses.map((sense) => sense.id)])
  const live = view.facts.filter((fact) => own.has(fact.subject_id) && isLive(fact))
  return { live: live.length, flagged: live.filter(isFlawed).length }
}

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
