import type { EntryId, FactId, FactStatus, SenseId, StoredInventorySense } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import type { Fact, FactOf } from './fact'
import { commonSenses, currentInventory, inventoryIds, inventorySenses, inventorySettled } from './inventory'

const entryId = 'e0000000-0000-4000-8000-000000000001' as EntryId
const at = '2026-01-01T00:00:00.000Z'
const sense = (n: number, rank: StoredInventorySense['rank'] = 'common'): StoredInventorySense => ({
  id: `s0000000-0000-4000-8000-00000000000${n}` as SenseId,
  pos: 'noun',
  gloss: `Sense ${n}.`,
  rank,
})
const inventory = (
  id: string,
  senses: StoredInventorySense[],
  status: FactStatus,
  supersedesId: string | null = null,
): FactOf<'senses'> => ({
  id: id as FactId,
  kind: 'senses',
  subjectId: entryId,
  objectId: null,
  contentKey: id,
  payload: { senses },
  status,
  supersedesId: supersedesId as FactId | null,
  author: 'agent:a',
  review: null,
  createdAt: at,
  updatedAt: at,
})
const syllables: Fact = {
  ...inventory('y', [], 'published'),
  kind: 'syllables',
  payload: { syllables: ['bank'] },
}

describe('sense inventory', () => {
  const published = inventory('i1', [sense(1), sense(2), sense(3, 'extra')], 'published')
  const correction = inventory('i2', [sense(2), sense(1)], 'pending', 'i1')

  it('is the inventory no counted correction supersedes [spec: facts/inventory-current]', () => {
    expect(currentInventory([syllables])).toBeNull()
    expect(currentInventory([published, syllables])).toBe(published)
    expect(currentInventory([published, correction])).toBe(correction)
    expect(currentInventory([published, correction], (status) => status === 'published')).toBe(published)
    expect(currentInventory([inventory('r', [sense(1)], 'rejected')])).toBeNull()
  })

  it('lists its senses in order, common first [spec: facts/inventory-current]', () => {
    expect(inventorySenses(null)).toEqual([])
    expect(inventorySenses(published).map((one) => one.gloss)).toEqual(['Sense 1.', 'Sense 2.', 'Sense 3.'])
    expect(commonSenses(published).map((one) => one.gloss)).toEqual(['Sense 1.', 'Sense 2.'])
    expect(commonSenses(null)).toEqual([])
    expect(inventoryIds(correction)).toEqual([sense(2).id, sense(1).id])
    expect(inventoryIds(null)).toEqual([])
  })

  it('is settled once an inventory is published [spec: facts/inventory-current]', () => {
    expect(inventorySettled([correction])).toBe(false)
    expect(inventorySettled([published, correction])).toBe(true)
  })
})
