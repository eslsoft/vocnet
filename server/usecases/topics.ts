import { type ReadVariant, shapeSenseSummary } from '@server/domain/public-view'
import { leavesUnder, topicTree } from '@server/domain/topics'
import type { SenseSort, SenseSummary } from '@shared/catalog'
import type { TopicId } from '@shared/facts'
import type { TopicTree } from '@shared/topics'
import type { Deps } from './deps'
import { NotFoundError } from './errors'
import type { Page, PageRequest } from './ports'

export async function getTopicTree(deps: Pick<Deps, 'topics'>): Promise<TopicTree> {
  return topicTree(await deps.topics.list())
}

/** The leaf topics a topic id stands for: itself, or a category's leaves. An unknown id is not found. */
export async function leavesOf(deps: Pick<Deps, 'topics'>, id: TopicId): Promise<TopicId[]> {
  const nodes = await deps.topics.list()
  const topic = nodes.find((node) => node.id === id)
  if (!topic) throw new NotFoundError(`No topic has the id ${id}.`)
  return leavesUnder(topic, nodes)
}

/**
 * Published senses tagged with a leaf topic, or with any leaf of a category, by lemma, frequency,
 * or level. An id that names no topic is not found; there is no fuzzy fallback.
 */
export async function listTopicSenses(
  deps: Pick<Deps, 'topics' | 'publicViews'>,
  id: TopicId,
  sort: SenseSort,
  page: PageRequest,
  variant: ReadVariant,
): Promise<Page<SenseSummary>> {
  const found = await deps.publicViews.listTaggedSenses(await leavesOf(deps, id), sort, page)
  return { ...found, items: found.items.map((summary) => shapeSenseSummary(summary, variant)) }
}
