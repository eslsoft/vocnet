import type { EntrySnapshot } from '@server/domain/catalog-view'
import type { Fact, FactOf } from '@server/domain/fact'
import type { JevQuestions, LlmPrompt } from '@server/domain/fact-kinds'
import type { FeedbackRecord } from '@server/domain/feedback'
import type { EntryNode, SenseNode, SenseWithLemma } from '@server/domain/nodes'
import type { PrincipalRef } from '@server/domain/principal'
import type { Lemma } from '@server/domain/term'
import type { WorkLease } from '@server/domain/work'
import type { AgentId } from '@shared/agents'
import type { EntryRef, EntrySummary, Stats } from '@shared/catalog'
import type { EntryId, FactId, FactKind, FactStatus, Pos, Review, SenseId, Verdict } from '@shared/facts'
import type { FeedbackId, FeedbackStatus } from '@shared/feedback'
import type { WorkLeaseId } from '@shared/work'

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
  /** The sense of this entry and POS whose live `sense` fact has one of these content keys. */
  findSenseByGloss(entryId: EntryId, pos: Pos, contentKeys: string[]): Promise<{ sense: SenseNode; fact: Fact } | null>
  /**
   * Atomically creates a sense together with its defining fact, unless the entry already has a
   * sense of this POS with the same creation key; returns the stored sense and its defining fact,
   * the sense's first `sense` fact.
   */
  insertSenseWithFact(
    sense: SenseNode,
    fact: FactOf<'sense'>,
    creationKey: string,
  ): Promise<{ sense: SenseNode; fact: Fact }>
  /** The live `sense` facts of every sense of this entry, oldest sense and oldest fact first. */
  listLiveGlosses(entryId: EntryId): Promise<Array<{ sense: SenseNode; fact: FactOf<'sense'> }>>
  loadEntrySnapshot(entry: EntryNode): Promise<EntrySnapshot>
  /** Published entries whose lemma starts with prefix, in lemma order. */
  searchPublishedEntries(prefix: string, page: PageRequest): Promise<Page<EntryRef>>
  /** Every entry whose lemma starts with prefix, in any status, in lemma order. */
  listEntrySummaries(prefix: string, page: PageRequest): Promise<Page<EntrySummary>>
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
  /**
   * With `supersede`: mark the live facts of these kinds about this node, so each one's next
   * review reads the new version. Pending ones are marked too, or a first review that read the
   * old version could still publish.
   */
  revalidate?: { nodeId: EntryId | SenseId; kinds: readonly FactKind[] }
  /** A review applies only while the fact still carries the mark it read, none included. Omitted: no condition. */
  revalidateSince?: string | null
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
  /**
   * Conditional status write that also clears the fact's revalidation mark; false when the fact
   * was not in `from`. Throws ConflictError when the slot is taken.
   */
  transition(write: FactTransitionWrite): Promise<boolean>
  /** Live facts about this node (as subject or object) marked for a review against its new version. */
  listRevalidating(nodeId: EntryId | SenseId): Promise<FactId[]>
  /** Facts pending since before cutoff, or awaiting revalidation since before it. */
  listStuckBefore(cutoff: string, limit: number): Promise<FactId[]>
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

export interface WorkRepo {
  /**
   * Atomically leases the next entry whose entry fact is live and that has no unexpired lease,
   * replacing an expired one, and clears its revisit mark; null when no entry is claimable. An
   * entry claimed once comes first, oldest claim first; then never-claimed seed entries, oldest
   * first; then seed entries to revisit, oldest claim first; then other never-claimed entries,
   * oldest first; then other entries to revisit; then the rest, each oldest claim first.
   */
  claimNext(
    lease: Omit<WorkLease, 'entryId' | 'claimedAt'>,
    now: string,
  ): Promise<{ lease: WorkLease; entry: EntryNode } | null>
  /** Marks the entry as a seed entry; a repeat is a no-op. */
  markSeed(entryId: EntryId): Promise<void>
  findLease(id: WorkLeaseId): Promise<WorkLease | null>
  /**
   * Records the work on the entry, whether to revisit it, and deletes the lease while it is still
   * unexpired; false otherwise.
   */
  complete(lease: WorkLease, at: string, work: { note: string | null; revisit: boolean }): Promise<boolean>
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
  lease(): WorkLeaseId
}
