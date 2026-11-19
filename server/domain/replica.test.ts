import { describe, expect, it } from 'vitest'
import { canonicalUnit, entryIdOf, entryKey, planReplicaSync, replicaRow, TOPICS_KEY } from './replica'

describe('planReplicaSync', () => {
  it('pushes missing and changed units, removes the ones the source lacks, and keeps the rest [spec: replica/plan]', () => {
    const source = new Map([
      [entryKey('a'), 'same'],
      [entryKey('b'), 'new'],
      [entryKey('c'), 'fresh'],
      [TOPICS_KEY, 'taxonomy'],
    ])
    const replica = new Map([
      [entryKey('a'), 'same'],
      [entryKey('b'), 'old'],
      [entryKey('gone'), 'old'],
      [TOPICS_KEY, 'taxonomy'],
    ])
    expect(planReplicaSync(source, replica)).toEqual({
      push: [entryKey('b'), entryKey('c')],
      remove: [entryKey('gone')],
      unchanged: 2,
    })
  })

  it('pushes everything to an empty replica', () => {
    const source = new Map([[TOPICS_KEY, 'taxonomy']])
    expect(planReplicaSync(source, new Map())).toEqual({ push: [TOPICS_KEY], remove: [], unchanged: 0 })
  })
})

describe('canonicalUnit', () => {
  it('ignores the order rows come in, and changes with any value', () => {
    const rows = [
      { id: 1, body: 'x' },
      { id: 2, body: 'y' },
    ]
    expect(canonicalUnit([['t', rows]])).toBe(canonicalUnit([['t', [...rows].reverse()]]))
    expect(canonicalUnit([['t', rows]])).not.toBe(canonicalUnit([['t', [rows[0], { id: 2, body: 'z' }]]]))
  })
})

describe('replicaRow', () => {
  it('keeps only what reads need of a worklist row, so every revision is equal on the replica', () => {
    expect(
      replicaRow('worklist', {
        entry_id: 'e',
        created_at: '2026-01-01',
        live: 1,
        revision: 7,
        scored_revision: 6,
        view_revision: 5,
        completeness: 0.5,
      }),
    ).toEqual({ entry_id: 'e', created_at: '2026-01-01', live: 1 })
  })

  it('drops the id of a search row and keeps every other row as it is', () => {
    expect(replicaRow('public_search', { id: 4, entry_id: 'e', body: 'bank' })).toEqual({ entry_id: 'e', body: 'bank' })
    const form = { form: 'banks', entry_id: 'e', type: 'plural', pos: null }
    expect(replicaRow('public_forms', form)).toBe(form)
  })
})

describe('entryIdOf', () => {
  it("reads back the entry an entry's key names, and rejects any other key", () => {
    expect(entryIdOf(entryKey('e1'))).toBe('e1')
    expect(() => entryIdOf(TOPICS_KEY)).toThrow('is not an entry')
  })
})
