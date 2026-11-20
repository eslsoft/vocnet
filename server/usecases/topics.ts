import { mediaIdOf, topicImageProblem, WEBP } from '@server/domain/media'
import { type ReadVariant, shapeSenseSummary } from '@server/domain/public-view'
import { leavesUnder, topicTree } from '@server/domain/topics'
import type { SenseSort } from '@shared/catalog'
import type { TopicId } from '@shared/facts'
import { mediaUrl, type TopicImageResult } from '@shared/media'
import type { TopicSense, TopicTree } from '@shared/topics'
import { requireCurator } from './access'
import type { Deps } from './deps'
import { InvalidRequestError, NotFoundError } from './errors'
import type { Actor } from './facts'
import type { Page, PageRequest } from './ports'

/** The taxonomy with how many public senses and entries each topic and category lists now. */
export async function getTopicTree(deps: Pick<Deps, 'topics' | 'publicViews'>): Promise<TopicTree> {
  const [nodes, counts] = await Promise.all([deps.topics.list(), deps.publicViews.countTagged()])
  return topicTree(nodes, new Map(counts.map(({ topicId, senses, entries }) => [topicId, { senses, entries }])))
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
): Promise<Page<TopicSense>> {
  const found = await deps.publicViews.listTaggedSenses(await leavesOf(deps, id), sort, page)
  return {
    ...found,
    items: found.items.map(({ summary, rare }) => ({ ...shapeSenseSummary(summary, variant), rare })),
  }
}

/**
 * Gives a category or leaf topic its picture: a square WebP, stored under its SHA-256 before the
 * topic names it, so a topic never names a file that is not there. Curators only. Setting the same
 * picture again changes nothing.
 */
export async function setTopicImage(
  deps: Pick<Deps, 'topics' | 'media'>,
  actor: Actor,
  id: TopicId,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<TopicImageResult> {
  requireCurator(actor.principal)
  if (!(await deps.topics.find(id))) throw new NotFoundError(`No topic has the id ${id}.`)
  const problem = topicImageProblem(bytes)
  if (problem) throw new InvalidRequestError(problem)
  const imageId = await mediaIdOf(bytes)
  await deps.media.put(imageId, bytes, WEBP)
  await deps.topics.setImage(id, imageId)
  return { topic_id: id, image_url: mediaUrl(imageId) }
}
