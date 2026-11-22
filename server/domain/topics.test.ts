import type { TopicId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { categoryIdOf, isLeaf, type TopicNode, topicsUnder, topicTree, topicViewOf, topicViews } from './topics'

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
      image_url: id === 'food' ? `https://media.test/${imageId}` : null,
      sense_count: senses,
      entry_count: entries,
    })
    expect(topicTree(nodes, counts, 'https://media.test')).toEqual({
      categories: [
        { ...named('home'), topics: [named('kitchen')] },
        { ...named('food', 5, 4), topics: [named('fruit', 3, 2), named('drinks')] },
      ],
    })
  })

  it('shows a reviewer each category with its topics, and each topic with its category name', () => {
    expect(topicViews(nodes)).toEqual([
      { category: null, topic: 'home en', topics: ['kitchen en'] },
      { category: 'home en', topic: 'kitchen en', topics: [] },
      { category: null, topic: 'food en', topics: ['fruit en', 'drinks en'] },
      { category: 'food en', topic: 'fruit en', topics: [] },
      { category: 'food en', topic: 'drinks en', topics: [] },
    ])
    expect(topicViewOf('drinks' as TopicId, nodes)).toEqual({ category: 'food en', topic: 'drinks en', topics: [] })
    expect(topicViewOf('unknown' as TopicId, nodes)).toBeNull()
    expect(() => topicViewOf('lost' as TopicId, [node('lost', 'gone', 0)])).toThrow('which does not exist')
  })

  it('selects a topic itself and a category with its topics [spec: topics/senses]', () => {
    const fruit = nodes[3] as TopicNode
    expect([isLeaf(fruit), isLeaf(food)]).toEqual([true, false])
    expect(topicsUnder(fruit, nodes)).toEqual(['fruit'])
    expect(topicsUnder(food, nodes)).toEqual(['food', 'drinks', 'fruit'])
    expect([categoryIdOf(fruit), categoryIdOf(food)]).toEqual(['food', 'food'])
  })
})
