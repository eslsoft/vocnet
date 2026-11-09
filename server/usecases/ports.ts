import type { EntrySnapshot } from '@server/domain/catalog-view'
import type { Fact, FactOf } from '@server/domain/fact'
import type { JevQuestions, LlmPrompt } from '@server/domain/fact-kinds'
import type { FeedbackRecord } from '@server/domain/feedback'
import type { EntryNode, SenseNode, SenseWithLemma } from '@server/domain/nodes'
import type { PrincipalRef } from '@server/domain/principal'
import type { Lemma } from '@server/domain/term'
import type { AgentId } from '@shared/agents'
import type { EntryRef, Stats } from '@shared/catalog'
import type { EntryId, FactId, FactKind, FactStatus, Pos, Review, SenseId, Verdict } from '@shared/facts'
import type { FeedbackId, FeedbackStatus } from '@shared/feedback'

// Interfaces for everything beyond the process boundary. Implemented in adapters/.

export interface PageRequest {
  limit: number
  /** Opaque; produced by the repo that pages. */
  cursor?: string
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface NodeRepo {
  findEntryByLemma(lemma: Lemma): Promise<EntryNode | null>
  findEntry(id: EntryId): Promise<EntryNode | null>
  /** Inserts unless the lemma exists; returns the stored entry either way. */
  insertEntry(entry: EntryNode): Promise<EntryNode>
  findSense(id: SenseId): Promise<SenseWithLemma | null>
  /** The sense of this entry and POS whose live `sense` fact has this content key. */
  findSenseByGloss(entryId: EntryId, pos: Pos, contentKey: string): Promise<{ sense: SenseNode; fact: Fact } | null>
  /**
   * Atomically creates a sense together with its defining fact, unless the entry already has a
   * sense of this POS created with the same gloss; returns the stored sense and its defining fact.
   */
  insertSenseWithFact(sense: SenseNode, fact: FactOf<'sense'>): Promise<{ sense: SenseNode; fact: Fact }>
  loadEntrySnapshot(entry: EntryNode): Promise<EntrySnapshot>
  /** Published entries whose lemma starts with prefix, in lemma order. */
  searchPublishedEntries(prefix: string, page: PageRequest): Promise<Page<EntryRef>>
  /** Published form facts with one of these content keys, on published entries. */
  findPublishedForms(contentKeys: string[]): Promise<Array<{ entry: EntryNode; fact: FactOf<'form'> }>>
}

export interface FactTransitionWrite {
  id: FactId
  from: readonly FactStatus[]
  to: FactStatus
  at: string
  review?: Review
  /** Published fact to mark superseded in the same batch, if this write publishes a correction. */
  supersede?: FactId
}

export interface FactRepo {
  find(id: FactId): Promise<Fact | null>
  findLive(kind: FactKind, subjectId: EntryId | SenseId, contentKey: string): Promise<Fact | null>
  listLive(kind: FactKind, subjectId: EntryId | SenseId): Promise<Fact[]>
  /**
   * Inserts unless a live fact holds the same (kind, subject, content key) and returns the live
   * fact either way; null when another live fact holds the kind's exclusive slot.
   */
  insert(fact: Fact): Promise<Fact | null>
  /** Conditional status write; false when the fact was not in `from`. Throws ConflictError when the slot is taken. */
  transition(write: FactTransitionWrite): Promise<boolean>
  listPendingUpdatedBefore(cutoff: string, limit: number): Promise<FactId[]>
  list(filter: { status?: FactStatus; kind?: FactKind }, page: PageRequest): Promise<Page<Fact>>
  countByKindAndStatus(): Promise<Stats['facts']>
}

export interface FeedbackRepo {
  insert(item: FeedbackRecord): Promise<void>
  find(id: FeedbackId): Promise<FeedbackRecord | null>
  /** Compare-and-set on revision; false when someone else wrote first. */
  update(next: FeedbackRecord, expectedRevision: number): Promise<boolean>
  list(filter: { status?: FeedbackStatus }, page: PageRequest): Promise<Page<FeedbackRecord>>
  countOpen(): Promise<number>
}

export interface AgentRecord {
  id: AgentId
  name: string
  createdBy: PrincipalRef
  createdAt: string
  revokedAt: string | null
}

export interface AgentRepo {
  insert(agent: AgentRecord, keyHash: string): Promise<void>
  find(id: AgentId): Promise<AgentRecord | null>
  findByKeyHash(keyHash: string): Promise<AgentRecord | null>
  list(): Promise<AgentRecord[]>
  revoke(id: AgentId, at: string): Promise<void>
}

export interface JevAnswers {
  model: string
  /** Probability per question key, in [0, 1]. */
  answers: Record<string, number>
}

export interface JevReviewer {
  ask(questions: JevQuestions, state: Record<string, unknown>): Promise<JevAnswers>
}

export interface LlmJudgement {
  model: string
  verdict: Verdict
  confidence: number
  reason: string
}

export interface LlmReviewer {
  judge(prompt: LlmPrompt): Promise<LlmJudgement>
}

/** The reviewer could not be reached or failed upstream. Not a verdict: retry later. */
export class ReviewerTransportError extends Error {
  override name = 'ReviewerTransportError'
}

/** The reviewer answered with something that breaks its contract. */
export class ReviewerProtocolError extends Error {
  override name = 'ReviewerProtocolError'
}

export interface ReviewJob {
  factId: FactId
  traceId: string
}

export interface ReviewQueue {
  enqueue(jobs: ReviewJob[]): Promise<void>
}

export interface RateLimiter {
  /** False when this key has used up its allowance for the current period. */
  allow(key: string): Promise<boolean>
}

export interface AuthUser {
  sub: string
  email: string | null
  name: string | null
}

export interface AuthVerifier {
  /** Verifies a bearer token or throws InvalidCredentialError. */
  verify(token: string): Promise<AuthUser>
}

export interface AgentKeyCrypto {
  randomSecret(): string
  hash(key: string): Promise<string>
}

export interface Clock {
  now(): Date
}

export interface IdGenerator {
  entry(): EntryId
  sense(): SenseId
  fact(): FactId
  feedback(): FeedbackId
  agent(): AgentId
}
