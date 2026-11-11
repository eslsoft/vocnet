import { assessEntry, reconcileItems } from '@server/domain/work'
import type { Deps } from './deps'
import type { StaleWork } from './ports'

export type ScoreDeps = Pick<Deps, 'work' | 'nodes'>

/** Assesses the entry and stores its scores and work items as of the stale revision: the items converge on its open work. */
async function rescore(deps: ScoreDeps, stale: StaleWork): Promise<void> {
  const entry = await deps.nodes.findEntry(stale.entryId)
  if (!entry) throw new Error(`Worklist entry ${stale.entryId} does not exist.`)
  const [snapshot, stored] = await Promise.all([deps.nodes.loadEntrySnapshot(entry), deps.work.listItems(entry.id)])
  const { work, completeness, quality, slots } = assessEntry(snapshot)
  await deps.work.saveAssessment(stale, { completeness, quality, slots }, reconcileItems(stored, work, snapshot))
}

/**
 * Rescores the stale worklist rows of the entries that are, or own as a sense, these nodes, or link
 * to them by a relation. `refreshEntries` calls it after every write; a row it leaves stale keeps
 * its items as of its last rescore until `refreshStaleWork` gets to it.
 */
export async function refreshWork(deps: ScoreDeps, nodeIds: Array<string | null>): Promise<void> {
  const ids = nodeIds.filter((id): id is string => id !== null)
  for (const stale of await deps.work.listStale(ids)) await rescore(deps, stale)
}

const STALE_BATCH = 100

/**
 * Rescores up to `limit` stale rows of any entry. Every row is tried before the failures are
 * thrown, so a row that keeps failing takes one slot and the rows behind it still drain.
 */
export async function rescoreStaleWork(
  deps: ScoreDeps,
  limit: number,
): Promise<{ rescored: number; remaining: number }> {
  const stale = await deps.work.listAnyStale(limit)
  const failures: unknown[] = []
  for (const row of stale) await rescore(deps, row).catch((error: unknown) => failures.push(error))
  if (failures.length > 0)
    throw new AggregateError(failures, `${failures.length} stale worklist rows failed to rescore.`)
  return { rescored: stale.length, remaining: await deps.work.countStale() }
}

/** Rescores rows a crashed request or a migration left stale, a batch at a time. */
export async function refreshStaleWork(deps: ScoreDeps): Promise<number> {
  return (await rescoreStaleWork(deps, STALE_BATCH)).rescored
}
