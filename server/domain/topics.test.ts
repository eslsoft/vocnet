import type { TopicId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { isLeaf, leafViews, leavesUnder, type TopicNode, topicTree } from './topics'

const node = (id: string, parentId: string | null, position: number): TopicNode => ({
  id: id as TopicId,
  parentId: parentId as TopicId | null,
  nameEn: `${id} en`,
  nameZh: `${id} zh`,
  position,
})
const food = node('food', null, 2)
const home = node('home', null, 1)
const nodes = [food, node('drinks', 'food', 2), node('kitchen', 'home', 1), node('fruit', 'food', 1), home]

describe('topic taxonomy', () => {
  it('serves categories with their leaves, each in display order [spec: topics/tree]', () => {
    expect(topicTree(nodes)).toEqual({
      categories: [
        {
          id: 'home',
          name_en: 'home en',
          name_zh: 'home zh',
          topics: [{ id: 'kitchen', name_en: 'kitchen en', name_zh: 'kitchen zh' }],
        },
        {
          id: 'food',
          name_en: 'food en',
          name_zh: 'food zh',
          topics: [
            { id: 'fruit', name_en: 'fruit en', name_zh: 'fruit zh' },
            { id: 'drinks', name_en: 'drinks en', name_zh: 'drinks zh' },
          ],
        },
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
