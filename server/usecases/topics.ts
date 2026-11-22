import { type ReadVariant, shapeSenseSummary } from '@server/domain/public-view'
import { topicsUnder, topicTree } from '@server/domain/topics'
import type { SenseSort } from '@shared/catalog'
import type { TopicId } from '@shared/facts'
import type { TopicImageResult } from '@shared/media'
import type { TopicSense, TopicTree } from '@shared/topics'
import { requireCurator } from './access'
import type { Deps } from './deps'
import { NotFoundError } from './errors'
import type { Actor } from './facts'
import { storePicture } from './media'
import type { Page, PageRequest } from './ports'

/** The taxonomy with how many public senses and entries each topic and category lists now. */
export async function getTopicTree(deps: Pick<Deps, 'topics' | 'publicViews' | 'mediaBaseUrl'>): Promise<TopicTree> {
  const [nodes, counts] = await Promise.all([deps.topics.list(), deps.publicViews.countTagged()])
  return topicTree(
    nodes,
    new Map(counts.map(({ topicId, senses, entries }) => [topicId, { senses, entries }])),
    deps.mediaBaseUrl,
  )
}

/** The topic ids a listing by this id reads: a topic's own, a category's own and its topics'. An unknown id is not found. */
export async function topicIdsOf(deps: Pick<Deps, 'topics'>, id: TopicId): Promise<TopicId[]> {
  const nodes = await deps.topics.list()
  const topic = nodes.find((node) => node.id === id)
  if (!topic) throw new NotFoundError(`No topic has the id ${id}.`)
  return topicsUnder(topic, nodes)
}

/**
 * Published senses tagged with a topic, or with a category or any of its topics, the topic's core
 * vocabulary before its specialized senses, each by lemma, frequency, or level. An id that names no
 * topic is not found; there is no fuzzy fallback.
 */
export async function listTopicSenses(
  deps: Pick<Deps, 'topics' | 'publicViews' | 'mediaBaseUrl'>,
  id: TopicId,
  sort: SenseSort,
  page: PageRequest,
  variant: ReadVariant,
): Promise<Page<TopicSense>> {
  const found = await deps.publicViews.listTaggedSenses(await topicIdsOf(deps, id), sort, page)
  return {
    ...found,
    items: found.items.map(({ summary, rare, specialized }) => ({
      ...shapeSenseSummary(summary, deps.mediaBaseUrl, variant),
      rare,
      specialized,
    })),
  }
}

/**
 * Gives a category or leaf topic its picture: a square WebP, stored under its SHA-256 before the
 * topic names it, so a topic never names a file that is not there. Curators only. Setting the same
 * picture again changes nothing.
 */
export async function setTopicImage(
  deps: Pick<Deps, 'topics' | 'media' | 'mediaBaseUrl'>,
  actor: Actor,
  id: TopicId,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<TopicImageResult> {
  requireCurator(actor.principal)
  if (!(await deps.topics.find(id))) throw new NotFoundError(`No topic has the id ${id}.`)
  const picture = await storePicture(deps, bytes)
  await deps.topics.setImage(id, picture.id)
  return { topic_id: id, image_url: picture.url }
}
