import { describe, expect, it } from 'vitest'
import { normalizeNoteText } from './note'

describe('normalizeNoteText', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeNoteText('  hello   world ')).toBe('hello world')
  })

  it('rejects blank text', () => {
    expect(() => normalizeNoteText('   ')).toThrow('must not be empty')
  })

  it('rejects text over the limit', () => {
    expect(() => normalizeNoteText('a'.repeat(501))).toThrow('at most')
  })
})
