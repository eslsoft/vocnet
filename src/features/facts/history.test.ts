import { describe, expect, it } from 'vitest'
import { fact } from '@/test/console-api'
import { factState } from './fact-state'
import { correctionChain } from './history'

const example = (text: string, overrides = {}) =>
  fact({ kind: 'example', payload: { sentence_id: crypto.randomUUID() as never, text }, ...overrides })

describe('correctionChain', () => {
  it('follows the supersedes links both ways, newest first', () => {
    const first = example('one', { status: 'superseded', created_at: '2026-11-01T00:00:00.000Z' })
    const second = example('two', {
      status: 'superseded',
      supersedes_id: first.id,
      created_at: '2026-11-02T00:00:00.000Z',
    })
    const third = example('three', { supersedes_id: second.id, created_at: '2026-11-03T00:00:00.000Z' })
    const other = example('other')
    expect(
      correctionChain(second, [first, third, other]).map((item) => (item.payload as { text: string }).text),
    ).toEqual(['three', 'two', 'one'])
    expect(correctionChain(other, [])).toEqual([other])
  })
})

describe('factState', () => {
  it('reads a published fact by its review', () => {
    expect(factState({ status: 'published', review: null })).toBe('published')
    expect(factState(example('x', { review: { ...example('x').review, verdict: 'uncertain' } }))).toBe('flagged')
    expect(factState(example('x', { review: { ...example('x').review, verdict: 'fail' } }))).toBe('failed')
    expect(factState({ status: 'rejected', review: null })).toBe('rejected')
  })
})
