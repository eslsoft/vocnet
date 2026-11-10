import { publicEntryDocument, publicViewRecord } from '@server/domain/public-view'
import type { Deps } from './deps'
import type { StaleView, StoredView, ViewLookup } from './ports'

export type ViewDeps = Pick<Deps, 'publicViews' | 'nodes' | 'reference'>

/** Projects the entry's public document from its facts and reference data as of the stale revision and stores it. */
async function rebuild(deps: ViewDeps, stale: StaleView): Promise<void> {
  const entry = await deps.nodes.findEntry(stale.entryId)
  if (!entry) throw new Error(`Public view entry ${stale.entryId} does not exist.`)
  const [snapshot, reference] = await Promise.all([
    deps.nodes.loadEntrySnapshot(entry),
    deps.reference.forLemma(entry.lemma),
  ])
  const document = publicEntryDocument(snapshot, reference)
  await deps.publicViews.save(stale, document && publicViewRecord(document))
}

/**
 * Rebuilds the stale public views of the entries that are, own as a sense, or link by a relation
 * to these nodes. Every use case that writes calls it after the write, beside the rescore.
 */
export async function refreshPublicViews(deps: ViewDeps, nodeIds: string[]): Promise<void> {
  for (const stale of await deps.publicViews.listStale(nodeIds)) await rebuild(deps, stale)
}

/**
 * Rebuilds up to `limit` stale views of any entry: the cron's sweep and the admin's drain. Every
 * view of the batch is tried before the failures are thrown, so one that keeps failing holds one
 * slot and the rest still drain.
 */
export async function rebuildStalePublicViews(
  deps: ViewDeps,
  limit: number,
): Promise<{ rebuilt: number; remaining: number }> {
  const stale = await deps.publicViews.listAnyStale(limit)
  const failures: unknown[] = []
  for (const view of stale) await rebuild(deps, view).catch((error: unknown) => failures.push(error))
  if (failures.length > 0) throw new AggregateError(failures, `${failures.length} public views failed to rebuild.`)
  return { rebuilt: stale.length, remaining: await deps.publicViews.countStale() }
}

/**
 * The view a lookup finds, rebuilt first when it is stale, so a read never serves a document older
 * than the facts it read. A write that lands during the rebuild leaves the view stale again; the
 * read serves what is stored and that write's own refresh rebuilds it.
 */
export async function readPublicView(
  deps: ViewDeps,
  find: () => Promise<ViewLookup | null>,
): Promise<StoredView | null> {
  const found = await find()
  if (!found?.stale) return found?.view ?? null
  await rebuild(deps, found.stale)
  return (await find())?.view ?? null
}
