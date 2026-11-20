import type { TopicId } from '@shared/facts'
import { type MediaId, mediaUrl } from '@shared/media'
import type { TopicTree } from '@shared/topics'

/**
 * One node of the two-level topic taxonomy. A category has no parent; a leaf topic belongs to one
 * category. Only leaves tag senses. Ids are stable; names are display labels.
 */
export interface TopicNode {
  id: TopicId
  parentId: TopicId | null
  nameEn: string
  nameZh: string
  /** Display order among its siblings. */
  position: number
  /** The picture a curator gave it, or null. */
  imageId: MediaId | null
}

export const isLeaf = (topic: TopicNode) => topic.parentId !== null

/** What a reviewer reads about a leaf topic: its English name and its category's. */
export interface TopicView {
  category: string
  topic: string
}

const byPosition = (a: TopicNode, b: TopicNode) => a.position - b.position

/** How many public senses and entries a topic or category lists; a topic absent here lists none. */
export type TopicCounts = ReadonlyMap<TopicId, { senses: number; entries: number }>

/** Categories with their leaf topics, each in display order, with what each lists. */
export function topicTree(nodes: readonly TopicNode[], counts: TopicCounts): TopicTree {
  const name = (node: TopicNode) => ({
    id: node.id,
    name: { en: node.nameEn, zh: node.nameZh },
    image_url: node.imageId === null ? null : mediaUrl(node.imageId),
    sense_count: counts.get(node.id)?.senses ?? 0,
    entry_count: counts.get(node.id)?.entries ?? 0,
  })
  return {
    categories: nodes
      .filter((node) => !isLeaf(node))
      .sort(byPosition)
      .map((category) => ({
        ...name(category),
        topics: nodes
          .filter((node) => node.parentId === category.id)
          .sort(byPosition)
          .map(name),
      })),
  }
}

/** Every leaf topic with its category's name, in display order: categories, then their leaves. */
export const leafViews = (nodes: readonly TopicNode[]): TopicView[] =>
  topicTree(nodes, new Map()).categories.flatMap((category) =>
    category.topics.map((topic) => ({ category: category.name.en, topic: topic.name.en })),
  )

/** The leaves a topic id selects: itself when it is a leaf, every topic of it when it is a category. */
export function leavesUnder(topic: TopicNode, nodes: readonly TopicNode[]): TopicId[] {
  if (isLeaf(topic)) return [topic.id]
  return nodes.filter((node) => node.parentId === topic.id).map((node) => node.id)
}
