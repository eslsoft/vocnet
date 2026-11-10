import { assessEntry, isStalled } from '@server/domain/work'
import type { Deps } from './deps'
import type { StaleWork } from './ports'

export type ScoreDeps = Pick<Deps, 'work' | 'nodes'>

async function rescore(deps: ScoreDeps, stale: StaleWork): Promise<void> {
  const entry = await deps.nodes.findEntry(stale.entryId)
  if (!entry) throw new Error(`Worklist entry ${stale.entryId} does not exist.`)
  const assessment = assessEntry(await deps.nodes.loadEntrySnapshot(entry))
  await deps.work.saveScores(stale, {
    completeness: assessment.completeness,
    quality: assessment.quality,
    stalled: isStalled(stale.lastClaim, assessment),
    awaitingReview: assessment.awaitingReview,
  })
}

/**
 * Rescores the stale worklist rows of the entries that are, or own as a sense, these nodes, or link
 * to them by a relation. `refreshEntries` calls it after every write; a row it leaves stale stays
 * claimable until `refreshStaleWork` gets to it.
 */
export async function refreshWork(deps: ScoreDeps, nodeIds: Array<string | null>): Promise<void> {
  const ids = nodeIds.filter((id): id is string => id !== null)
  for (const stale of await deps.work.listStale(ids)) await rescore(deps, stale)
}

const STALE_BATCH = 100

/**
 * Rescores rows a crashed request left stale, a batch at a time. Every row in the batch is tried
 * before the failures are thrown, so a row that keeps failing takes one slot of the batch and the
 * rows behind it still drain.
 */
export async function refreshStaleWork(deps: ScoreDeps): Promise<number> {
  const stale = await deps.work.listAnyStale(STALE_BATCH)
  const failures: unknown[] = []
  for (const row of stale) await rescore(deps, row).catch((error: unknown) => failures.push(error))
  if (failures.length > 0)
    throw new AggregateError(failures, `${failures.length} stale worklist rows failed to rescore.`)
  return stale.length
}
