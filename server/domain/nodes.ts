import type { EntryId, FactId, FactStatus, Pos, SenseId, SentenceId } from '@shared/facts'
import type { PrincipalRef } from './principal'
import type { Lemma } from './term'

export interface EntryNode {
  id: EntryId
  lemma: Lemma
  createdBy: PrincipalRef
  createdAt: string
}

export interface SenseNode {
  id: SenseId
  entryId: EntryId
  pos: Pos
  createdBy: PrincipalRef
  createdAt: string
}

export interface SenseWithLemma extends SenseNode {
  lemma: Lemma
}

/** A sentence: an example, a saying, or both, as its facts make it on read. */
export interface SentenceNode {
  id: SentenceId
  text: string
  /** Where it comes from (a book or film title); null when a producer made it up. */
  source: string | null
  createdBy: PrincipalRef
  createdAt: string
}

/**
 * Where a sentence is used: the live examples that name it, with their sense and entry, and the
 * live phrases lists that name it a saying, with their headword.
 */
export interface SentenceUses {
  examples: Array<{ factId: FactId; status: FactStatus; senseId: SenseId; entryId: EntryId; lemma: Lemma }>
  sayings: Array<{ factId: FactId; status: FactStatus; entryId: EntryId; lemma: Lemma }>
}
