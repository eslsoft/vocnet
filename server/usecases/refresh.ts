import type { Deps } from './deps'
import { refreshPublicViews } from './public-view'
import { refreshWork } from './work-scores'

export type RefreshDeps = Pick<Deps, 'work' | 'nodes' | 'reference' | 'publicViews'>

/**
 * Brings what derives from these nodes' entries up to date after a write: the worklist scores and
 * the public views of the entries that are, own as a sense, or link by a relation to the nodes.
 * Every use case that writes facts, senses, feedback, or work calls it after the write.
 */
export async function refreshEntries(deps: RefreshDeps, nodeIds: Array<string | null>): Promise<void> {
  const ids = nodeIds.filter((id): id is string => id !== null)
  await refreshWork(deps, ids)
  await refreshPublicViews(deps, ids)
}
