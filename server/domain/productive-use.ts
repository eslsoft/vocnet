import type { Skill } from '@shared/catalog'
import type { Register } from '@shared/facts'

const SPOKEN: ReadonlySet<Register> = new Set(['informal', 'slang', 'taboo', 'offensive'])
const WRITTEN: ReadonlySet<Register> = new Set(['formal', 'literary'])

/** Where a part of speech leans: every common sense carries a spoken, or every one a written, register. */
function leaning(registers: readonly (Register | undefined)[]): 'spoken' | 'written' | null {
  if (registers.length === 0) return null
  if (registers.every((register) => register !== undefined && SPOKEN.has(register))) return 'spoken'
  if (registers.every((register) => register !== undefined && WRITTEN.has(register))) return 'written'
  return null
}

/**
 * The skills a tier needs the word for: an active word is heard, said, read, and written, a passive
 * one heard and read; a part of speech that leans spoken or written keeps only that channel.
 */
export function skillsOf(active: boolean, registers: readonly (Register | undefined)[]): Skill[] {
  const channel = leaning(registers)
  const spoken: Skill[] = active ? ['listen', 'speak'] : ['listen']
  const written: Skill[] = active ? ['read', 'write'] : ['read']
  if (channel === 'spoken') return spoken
  if (channel === 'written') return written
  return active ? ['listen', 'speak', 'read', 'write'] : ['listen', 'read']
}
