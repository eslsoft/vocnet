import {
  type ByLanguage,
  type ProjectionContext,
  projectPublicEntry,
  type StoredEntry,
} from '@server/domain/catalog-view'
import type { EntryNode } from '@server/domain/nodes'
import { publicViewRecord, type TopicCategoryIds } from '@server/domain/public-view'
import { categoryIdOf, type TopicNode } from '@server/domain/topics'
import type { TopicId } from '@shared/facts'
import type { Deps } from './deps'
import type { StaleView, StoredView, ViewLookup } from './ports'

export type ViewDeps = Pick<Deps, 'publicViews' | 'nodes' | 'reference' | 'topics'>

const namesOf = (topics: readonly TopicNode[]): ProjectionContext['topicNames'] =>
  new Map<TopicId, ByLanguage<string>>(topics.map((topic) => [topic.id, { en: topic.nameEn, zh: topic.nameZh }]))

/** Each topic's names by language tag, as public documents show them. */
export async function topicNamesOf(deps: Pick<Deps, 'topics'>): Promise<ProjectionContext['topicNames']> {
  return namesOf(await deps.topics.list())
}

/** What a rebuild reads of the taxonomy: each topic's names, and the category each belongs to. */
interface ViewTaxonomy {
  names: ProjectionContext['topicNames']
  categories: TopicCategoryIds
}

async function viewTaxonomyOf(deps: Pick<Deps, 'topics'>): Promise<ViewTaxonomy> {
  const topics = await deps.topics.list()
  return { names: namesOf(topics), categories: new Map(topics.map((topic) => [topic.id, categoryIdOf(topic)])) }
}

/** The entry's public document as its facts, reference data, and topics make it now; null when it is not public. */
export async function projectEntry(
  deps: Pick<Deps, 'nodes' | 'reference'>,
  entry: EntryNode,
  topicNames: ProjectionContext['topicNames'],
): Promise<StoredEntry | null> {
  const [snapshot, reference] = await Promise.all([
    deps.nodes.loadEntrySnapshot(entry),
    deps.reference.forLemma(entry.lemma),
  ])
  return projectPublicEntry(snapshot, { reference, topicNames })
}

/** Projects the entry's public document as of the stale revision and stores it. */
async function rebuild(deps: ViewDeps, stale: StaleView, taxonomy: ViewTaxonomy): Promise<void> {
  const entry = await deps.nodes.findEntry(stale.entryId)
  if (!entry) throw new Error(`Public view entry ${stale.entryId} does not exist.`)
  const document = await projectEntry(deps, entry, taxonomy.names)
  await deps.publicViews.save(stale, document && publicViewRecord(document, taxonomy.categories))
}

/**
 * Rebuilds the stale public views of the entries that are, own as a sense, or link by a relation
 * to these nodes. Every use case that writes calls it after the write, beside the rescore.
 */
export async function refreshPublicViews(deps: ViewDeps, nodeIds: string[]): Promise<void> {
  const stale = await deps.publicViews.listStale(nodeIds)
  if (stale.length === 0) return
  const taxonomy = await viewTaxonomyOf(deps)
  for (const view of stale) await rebuild(deps, view, taxonomy)
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
  const taxonomy = await viewTaxonomyOf(deps)
  const failures: unknown[] = []
  for (const view of stale) await rebuild(deps, view, taxonomy).catch((error: unknown) => failures.push(error))
  if (failures.length > 0) throw new AggregateError(failures, `${failures.length} public views failed to rebuild.`)
  return { rebuilt: stale.length, remaining: await deps.publicViews.countStale() }
}

/** Rebuilds a read makes in a row while each loses to a newer write and no view was ever stored. */
const READ_REBUILD_ATTEMPTS = 3

/**
 * The view a lookup finds, rebuilt first when it is stale, so a read never serves a document older
 * than the facts it read. A write that lands during the rebuild leaves the view stale again; the
 * read serves what is stored and that write's own refresh rebuilds it. When nothing is stored yet,
 * serving it would be a 404 for a public entry, so the read rebuilds again, up to
 * READ_REBUILD_ATTEMPTS times, and is a 404 only when the projection itself is empty.
 */
export async function readPublicView<T extends ViewLookup>(
  deps: ViewDeps,
  find: () => Promise<T | null>,
): Promise<(T & { view: StoredView }) | null> {
  let found = await find()
  for (let attempt = 0; found?.stale && attempt < READ_REBUILD_ATTEMPTS; attempt += 1) {
    await rebuild(deps, found.stale, await viewTaxonomyOf(deps))
    found = await find()
    if (found?.view) break
  }
  return found?.view ? (found as T & { view: StoredView }) : null
}
