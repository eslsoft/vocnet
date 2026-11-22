import type { TopicId } from '@shared/facts'
import { type MediaId, mediaUrl } from '@shared/media'
import type { TopicTree } from '@shared/topics'

/**
 * One node of the two-level topic taxonomy. A category has no parent; a topic belongs to one
 * category. Both tag senses: a sense takes the topic its meaning belongs to, or the category itself
 * when none of its topics holds it. Ids are stable; names are display labels.
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

/**
 * What a reviewer reads about a node: its English name, its category's (null for a category), and
 * a category's topics, so a reviewer can tell whether one of them holds the sense instead.
 */
export interface TopicView {
  category: string | null
  topic: string
  /** The English names of a category's topics; empty for a topic. */
  topics: readonly string[]
}

const byPosition = (a: TopicNode, b: TopicNode) => a.position - b.position

const childrenOf = (id: TopicId, nodes: readonly TopicNode[]) =>
  nodes.filter((node) => node.parentId === id).sort(byPosition)

/** How many public senses and entries a topic or category lists; a topic absent here lists none. */
export type TopicCounts = ReadonlyMap<TopicId, { senses: number; entries: number }>

/** Categories with their leaf topics, each in display order, with what each lists. */
export function topicTree(nodes: readonly TopicNode[], counts: TopicCounts, media: string): TopicTree {
  const name = (node: TopicNode) => ({
    id: node.id,
    name: { en: node.nameEn, zh: node.nameZh },
    image_url: node.imageId === null ? null : mediaUrl(media, node.imageId),
    sense_count: counts.get(node.id)?.senses ?? 0,
    entry_count: counts.get(node.id)?.entries ?? 0,
  })
  return {
    categories: nodes
      .filter((node) => !isLeaf(node))
      .sort(byPosition)
      .map((category) => ({
        ...name(category),
        topics: childrenOf(category.id, nodes).map(name),
      })),
  }
}

function viewOf(node: TopicNode, nodes: readonly TopicNode[]): TopicView {
  if (node.parentId === null) {
    return { category: null, topic: node.nameEn, topics: childrenOf(node.id, nodes).map((child) => child.nameEn) }
  }
  const category = nodes.find((other) => other.id === node.parentId)
  if (!category) throw new Error(`Topic ${node.id} belongs to category ${node.parentId}, which does not exist.`)
  return { category: category.nameEn, topic: node.nameEn, topics: [] }
}

/** Every node as a reviewer reads it, in display order: each category, then its topics. */
export const topicViews = (nodes: readonly TopicNode[]): TopicView[] =>
  nodes
    .filter((node) => !isLeaf(node))
    .sort(byPosition)
    .flatMap((category) => [category, ...childrenOf(category.id, nodes)].map((node) => viewOf(node, nodes)))

/** What a reviewer reads of the node with this id; null when no node has it. */
export function topicViewOf(id: TopicId, nodes: readonly TopicNode[]): TopicView | null {
  const node = nodes.find((other) => other.id === id)
  return node ? viewOf(node, nodes) : null
}

/** The ids a topic's listing reads: a topic's own, a category's own and every one of its topics'. */
export function topicsUnder(topic: TopicNode, nodes: readonly TopicNode[]): TopicId[] {
  if (isLeaf(topic)) return [topic.id]
  return [topic.id, ...nodes.filter((node) => node.parentId === topic.id).map((node) => node.id)]
}

/** The category a node belongs to: a category's own id, a topic's parent. */
export const categoryIdOf = (topic: TopicNode): TopicId => topic.parentId ?? topic.id
