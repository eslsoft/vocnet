import type { TopicId } from '@shared/facts'
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
}

export const isLeaf = (topic: TopicNode) => topic.parentId !== null

/** What a reviewer reads about a leaf topic: its English name and its category's. */
export interface TopicView {
  category: string
  topic: string
}

const byPosition = (a: TopicNode, b: TopicNode) => a.position - b.position

/** Categories with their leaf topics, each in display order. */
export function topicTree(nodes: readonly TopicNode[]): TopicTree {
  const name = (node: TopicNode) => ({ id: node.id, name_en: node.nameEn, name_zh: node.nameZh })
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

/** The leaves a topic id selects: itself when it is a leaf, every topic of it when it is a category. */
export function leavesUnder(topic: TopicNode, nodes: readonly TopicNode[]): TopicId[] {
  if (isLeaf(topic)) return [topic.id]
  return nodes.filter((node) => node.parentId === topic.id).map((node) => node.id)
}
