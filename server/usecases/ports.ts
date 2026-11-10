import type { EntrySnapshot, StoredSenseSummary, StoredSummary } from '@server/domain/catalog-view'
import type { Fact, FactOf } from '@server/domain/fact'
import type { CefrListing, JevQuestions, LlmPrompt, Rereview } from '@server/domain/fact-kinds'
import type { FeedbackRecord } from '@server/domain/feedback'
import type { EntryNode, SenseNode, SenseWithLemma } from '@server/domain/nodes'
import type { PrincipalRef } from '@server/domain/principal'
import type { EntryLinks, PublicViewRecord } from '@server/domain/public-view'
import type { Lemma } from '@server/domain/term'
import type { TopicNode } from '@server/domain/topics'
import type { LastClaim, WorkLease } from '@server/domain/work'
import type { AgentId } from '@shared/agents'
import type { EntrySummary, Stats } from '@shared/catalog'
import type {
  EntryId,
  FactId,
  FactKind,
  FactStatus,
  FormType,
  Pos,
  Review,
  SenseId,
  TopicId,
  Verdict,
} from '@shared/facts'
import type { FeedbackId, FeedbackStatus } from '@shared/feedback'
import type { LemmaReference, ReferenceSource } from '@shared/reference'
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
  /** Every entry whose lemma starts with prefix, in any status, in lemma order. */
  listEntrySummaries(prefix: string, page: PageRequest): Promise<Page<EntrySummary>>
  /** Live form facts with one of these content keys, on entries whose entry fact is live. */
  findLiveForms(contentKeys: string[]): Promise<Array<{ entry: EntryNode; fact: FactOf<'form'> }>>
  /**
   * The lemmas of the other entries whose entry fact is live and whose lemma differs from this
   * entry's only in ASCII letter case, in lemma order.
   */
  listLiveCaseVariants(entry: EntryNode): Promise<Lemma[]>
}

/** Imported reference data, read by exact lemma spelling. */
export interface ReferenceRepo {
  forLemma(lemma: Lemma): Promise<LemmaReference>
  /** The CEFR listings of the exact lemma with their source names, lowest level first. */
  listCefrListings(lemma: Lemma): Promise<CefrListing[]>
  listSources(): Promise<ReferenceSource[]>
  /** Every lemma the CEFR profiles list that no entry has, lowest level first, then by lemma. */
  listCefrLemmasWithoutEntry(): Promise<Lemma[]>
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
  /**
   * The write applies only while the fact's subject holds fewer than `max` live facts of its kind,
   * not counting `excluding` (the fact a correction supersedes), counted in the same statement.
   */
  liveBelow?: { max: number; excluding: FactId | null }
  /** The write applies only while no live fact supersedes this one, checked in the same statement. */
  unsuperseded?: boolean
  /** The write applies only while this fact (the original a correction supersedes) is published, checked in the same statement. */
  originalPublished?: FactId
  /**
   * When the write applies, mark these facts of the other entry for a review in place, in the same
   * batch; facts already marked keep their mark.
   */
  rereview?: Rereview
}

export interface FactRepo {
  find(id: FactId): Promise<Fact | null>
  findLive(kind: FactKind, subjectId: EntryId | SenseId, contentKey: string): Promise<Fact | null>
  /** The live facts of a kind about a subject, oldest first. */
  listLive(kind: FactKind, subjectId: EntryId | SenseId): Promise<Fact[]>
  /** The live (pending or published) correction that supersedes this fact, if any. */
  findLiveCorrection(id: FactId): Promise<Fact | null>
  /**
   * Inserts unless a live fact holds the same (kind, subject, content key) and returns the live
   * fact either way; null when another live fact holds the kind's exclusive slot, the subject
   * already holds the kind's `maxLive` live facts (not counting the fact this one supersedes), or
   * this correction's original is not published or already has a live correction.
   */
  insert(fact: Fact): Promise<Fact | null>
  /**
   * Conditional status write that also clears the fact's revalidation mark; false when the fact
   * was not in `from`. Throws ConflictError when the slot is taken or the
   * original already has another live correction.
   */
  transition(write: FactTransitionWrite): Promise<boolean>
  /** Live facts about this node (as subject or object) marked for a review against its new version. */
  listRevalidating(nodeId: EntryId | SenseId): Promise<FactId[]>
  /** Facts pending since before cutoff, or awaiting revalidation since before it. */
  listStuckBefore(cutoff: string, limit: number): Promise<FactId[]>
  list(filter: { status?: FactStatus; kind?: FactKind }, page: PageRequest): Promise<Page<Fact>>
  countByKindAndStatus(): Promise<Stats['facts']>
}

export interface TopicRepo {
  /** Every category and leaf topic. */
  list(): Promise<TopicNode[]>
  find(id: TopicId): Promise<TopicNode | null>
}

/** A public view whose rows no longer describe the entry. */
export interface StaleView {
  entryId: EntryId
  /** The revision a rebuild describes once saved. */
  revision: number
}

/** An entry's public document as stored: the serialized stored document and a digest of it. */
export interface StoredView {
  json: string
  digest: string
}

/** An entry's public view as a read finds it. */
export interface ViewLookup {
  /** Set while the stored rows are older than the entry's facts or reference data. */
  stale: StaleView | null
  /** Null when the entry has no public document, or none was built yet. */
  view: StoredView | null
}

/** An entry's public view with what other entries' built views supply to it. */
export interface EntryViewLookup extends ViewLookup {
  links: EntryLinks
}

/** A built form row with the summary of the entry it belongs to. */
export interface FormRow {
  summary: StoredSummary
  /** The digest of that entry's document. */
  digest: string
  type: FormType
  pos: Pos | null
}

/** The public view: each entry's public document and the lookup rows derived from it. */
export interface PublicViewRepo {
  /** The view of the entry with exactly this lemma and its links; null when no entry has it. */
  findByLemma(lemma: Lemma): Promise<EntryViewLookup | null>
  /** The view of the entry that owns this sense; null when no sense has the id. */
  findBySense(id: SenseId): Promise<ViewLookup | null>
  /** Built form rows with one of these content keys, in lemma order. */
  findForms(contentKeys: string[]): Promise<FormRow[]>
  /** Summaries of the built public entries whose lemma starts with prefix, in lemma order. */
  listEntries(prefix: string, page: PageRequest): Promise<Page<StoredSummary>>
  /** Built public senses tagged with one of these leaves, each once, in lemma then sense order. */
  listTaggedSenses(leaves: readonly TopicId[], page: PageRequest): Promise<Page<StoredSenseSummary>>
  /** Stale views of the entries that are, or own as a sense, these nodes, or link to them by a relation. */
  listStale(nodeIds: string[]): Promise<StaleView[]>
  /** Up to `limit` stale views of any entry. */
  listAnyStale(limit: number): Promise<StaleView[]>
  countStale(): Promise<number>
  /**
   * Replaces the entry's view rows with these (none for null) as of the stale revision; a no-op
   * when another write bumped the revision since.
   */
  save(stale: StaleView, record: PublicViewRecord | null): Promise<void>
}

export interface FeedbackRepo {
  insert(item: FeedbackRecord): Promise<void>
  find(id: FeedbackId): Promise<FeedbackRecord | null>
  /** Compare-and-set on revision; false when someone else wrote first. */
  update(next: FeedbackRecord, expectedRevision: number): Promise<boolean>
  list(filter: { status?: FeedbackStatus }, page: PageRequest): Promise<Page<FeedbackRecord>>
  countOpen(): Promise<number>
}

/** A worklist row whose stored scores no longer describe the entry. */
export interface StaleWork {
  entryId: EntryId
  /** The revision a rescore describes once saved. */
  revision: number
  lastClaim: LastClaim
}

export interface WorkScores {
  completeness: number
  quality: number
  stalled: boolean
  awaitingReview: boolean
}

export interface WorkRepo {
  /**
   * Atomically leases the next claimable entry (see `isClaimable`) that has no unexpired lease,
   * replacing an expired one; null when none is. Order: `claimTier`, then least recently claimed
   * (never-claimed entries have no claim time), then highest frequency with none last, then lowest
   * completeness, then oldest.
   */
  claimNext(
    lease: Omit<WorkLease, 'entryId' | 'claimedAt'>,
    now: string,
  ): Promise<{ lease: WorkLease; entry: EntryNode } | null>
  /** Records the entry's open work as this claim found it, for the stall rule. */
  recordClaimedWork(lease: WorkLease, openWork: string): Promise<void>
  /** Marks the entry as a seed entry; a repeat is a no-op. */
  markSeed(entryId: EntryId): Promise<void>
  findLease(id: WorkLeaseId): Promise<WorkLease | null>
  /** Records the work on the entry, deletes the lease while it is still unexpired, and marks the row stale; false otherwise. */
  complete(lease: WorkLease, at: string, note: string | null): Promise<boolean>
  /**
   * Stale rows of the entries that are, or own as a sense, these nodes, and of the entries whose
   * relations link to a sense that is or belongs to one of them.
   */
  listStale(nodeIds: string[]): Promise<StaleWork[]>
  /** Up to `limit` stale rows of any entry. */
  listAnyStale(limit: number): Promise<StaleWork[]>
  /** Stores the scores as of the stale revision; a no-op when another write bumped it since. */
  saveScores(stale: StaleWork, scores: WorkScores): Promise<void>
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
