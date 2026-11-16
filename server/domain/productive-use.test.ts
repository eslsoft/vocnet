import { describe, expect, it } from 'vitest'
import { skillsOf } from './productive-use'

describe('skillsOf', () => {
  it('derives the skills of a tier from its use and the registers of the common senses [spec: catalog/productive-use-read]', () => {
    expect(skillsOf(true, [undefined])).toEqual(['listen', 'speak', 'read', 'write'])
    expect(skillsOf(false, [undefined])).toEqual(['listen', 'read'])
    expect(skillsOf(true, ['informal', 'slang'])).toEqual(['listen', 'speak'])
    expect(skillsOf(false, ['taboo', 'offensive'])).toEqual(['listen'])
    expect(skillsOf(true, ['formal', 'literary'])).toEqual(['read', 'write'])
    expect(skillsOf(false, ['formal'])).toEqual(['read'])
    // Mixed, unlabelled, or neither-channel registers lean nowhere.
    expect(skillsOf(true, ['informal', undefined])).toEqual(['listen', 'speak', 'read', 'write'])
    expect(skillsOf(true, ['informal', 'formal'])).toEqual(['listen', 'speak', 'read', 'write'])
    expect(skillsOf(false, ['dated', 'technical'])).toEqual(['listen', 'read'])
    expect(skillsOf(false, [])).toEqual(['listen', 'read'])
  })
})
