import { leavesUnder, topicTree } from '@server/domain/topics'
import type { TopicId } from '@shared/facts'
import type { TopicTree } from '@shared/topics'
import type { Deps } from './deps'
import { NotFoundError } from './errors'
import type { Page, PageRequest, TaggedSense } from './ports'

export async function getTopicTree(deps: Pick<Deps, 'topics'>): Promise<TopicTree> {
  return topicTree(await deps.topics.list())
}

/**
 * Published senses tagged with a leaf topic, or with any leaf of a category. An id that names no
 * topic is not found; there is no fuzzy fallback.
 */
export async function listTopicSenses(
  deps: Pick<Deps, 'topics'>,
  id: TopicId,
  page: PageRequest,
): Promise<Page<TaggedSense>> {
  const nodes = await deps.topics.list()
  const topic = nodes.find((node) => node.id === id)
  if (!topic) throw new NotFoundError(`No topic has the id ${id}.`)
  return deps.topics.listTaggedSenses(leavesUnder(topic, nodes), page)
}
