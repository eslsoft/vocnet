import { describe, expect, it } from 'vitest'
import { isLetterOfTheAlphabet } from './term'

describe('isLetterOfTheAlphabet', () => {
  it('is every single letter but the words "a" and "I" [spec: catalog/import-core]', () => {
    expect(['a', 'I', 'x', 'A', 'é', 'ad', "'s", 'according to'].map(isLetterOfTheAlphabet)).toEqual([
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
    ])
  })
})
