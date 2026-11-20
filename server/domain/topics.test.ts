import type { TopicId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { isLeaf, leafViews, leavesUnder, type TopicNode, topicTree } from './topics'

const node = (id: string, parentId: string | null, position: number): TopicNode => ({
  id: id as TopicId,
  parentId: parentId as TopicId | null,
  nameEn: `${id} en`,
  nameZh: `${id} zh`,
  position,
  imageId: null,
})
const imageId = 'a'.repeat(64)
const food = { ...node('food', null, 2), imageId }
const home = node('home', null, 1)
const nodes = [food, node('drinks', 'food', 2), node('kitchen', 'home', 1), node('fruit', 'food', 1), home]

describe('topic taxonomy', () => {
  it('serves categories with their leaves, each in display order [spec: topics/tree]', () => {
    const counts = new Map([
      ['food' as TopicId, { senses: 5, entries: 4 }],
      ['fruit' as TopicId, { senses: 3, entries: 2 }],
    ])
    const named = (id: string, senses = 0, entries = 0) => ({
      id,
      name: { en: `${id} en`, zh: `${id} zh` },
      image_url: id === 'food' ? `/v1/media/${imageId}` : null,
      sense_count: senses,
      entry_count: entries,
    })
    expect(topicTree(nodes, counts)).toEqual({
      categories: [
        { ...named('home'), topics: [named('kitchen')] },
        { ...named('food', 5, 4), topics: [named('fruit', 3, 2), named('drinks')] },
      ],
    })
  })

  it('shows a reviewer each leaf with its category name', () => {
    expect(leafViews(nodes)).toEqual([
      { category: 'home en', topic: 'kitchen en' },
      { category: 'food en', topic: 'fruit en' },
      { category: 'food en', topic: 'drinks en' },
    ])
  })

  it('selects a leaf itself and a category by its leaves [spec: topics/senses]', () => {
    const fruit = nodes[3] as TopicNode
    expect([isLeaf(fruit), isLeaf(food)]).toEqual([true, false])
    expect(leavesUnder(fruit, nodes)).toEqual(['fruit'])
    expect(leavesUnder(food, nodes)).toEqual(['drinks', 'fruit'])
  })
})
