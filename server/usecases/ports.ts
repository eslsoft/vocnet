import type { EntrySnapshot, StoredSenseSummary, StoredSummary } from '@server/domain/catalog-view'
import type { Fact, FactOf } from '@server/domain/fact'
import type { CefrListing, JevQuestions, Link, LlmPrompt, Rereview } from '@server/domain/fact-kinds'
import type { FeedbackRecord } from '@server/domain/feedback'
import type { EntryNode, SenseNode, SenseWithLemma } from '@server/domain/nodes'
import type { PrincipalRef } from '@server/domain/principal'
import type { EntryLinks, PublicViewRecord } from '@server/domain/public-view'
import type { Lemma } from '@server/domain/term'
import type { TopicNode } from '@server/domain/topics'
import type { ReconciledItems, SlotCounts, WorkItem, WorkLease } from '@server/domain/work'
import type { AgentId } from '@shared/agents'
import type { EntrySort, EntrySummary, SearchMatch, SenseSort } from '@shared/catalog'
import type {
  EntryId,
  FactId,
  FactKind,
  FactStatus,
  FormType,
  Pos,
  RelationDomain,
  Review,
  SenseId,
  TopicId,
  Verdict,
} from '@shared/facts'
import type { FeedbackId, FeedbackStatus } from '@shared/feedback'
import type { WorkAttemptOutcome } from '@shared/monitor'
import type { CefrLevel, LemmaReference, ReferenceSource } from '@shared/reference'
import type { Gap, WorkItemId, WorkLeaseId, WorkType } from '@shared/work'

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

/** A record with the entry it is about: the entry itself, or the entry its sense or fact belongs to. */
export type WithEntry<T> = T & { entry: { id: EntryId; lemma: Lemma } }

export interface NodeRepo {
  findEntryByLemma(lemma: Lemma): Promise<EntryNode | null>
  findEntry(id: EntryId): Promise<EntryNode | null>
  /** Inserts unless the lemma exists; returns the stored entry either way. */
  insertEntry(entry: EntryNode): Promise<EntryNode>
  findSense(id: SenseId): Promise<SenseWithLemma | null>
  /**
   * The sense of this entry and POS whose live `sense` fact means this gloss: its meaning key is
   * `meaningKey`, whatever its labels.
   */
  findSenseByGloss(entryId: EntryId, pos: Pos, meaningKey: string): Promise<{ sense: SenseNode; fact: Fact } | null>
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
  /** Every entry whose lemma starts with prefix and that the filter admits, in any status, in lemma order. */
  listEntrySummaries(filter: EntrySummaryFilter, page: PageRequest, now: string): Promise<Page<EntrySummary>>
  /**
   * Live form facts whose content key is one of these keys or one of them extended with labels
   * (`key|…`), on entries whose entry fact is live.
   */
  findLiveForms(contentKeys: string[]): Promise<Array<{ entry: EntryNode; fact: FactOf<'form'> }>>
  /**
   * The lemmas of the other entries whose entry fact is live and whose lemma differs from this
   * entry's only in ASCII letter case, in lemma order.
   */
  listLiveCaseVariants(entry: EntryNode): Promise<Lemma[]>
}

/** Which entries the management entry list shows. */
export interface EntrySummaryFilter {
  /** The lemma starts with it; empty for any lemma. */
  prefix: string
  /** The lemma's lowest CEFR level is this; null for any. */
  level: CefrLevel | null
  /** Only entries with a weak fact about them or their senses. */
  flagged: boolean
  /** Only entries with an item at the attempt bound. */
  stuck: boolean
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

export interface FactFilter {
  status?: FactStatus
  kind?: FactKind
  /** Only facts this principal authored. */
  author?: string
  /** Only facts about the entry with exactly this lemma or one of its senses. */
  lemma?: string
  /** Only weak facts: published on an uncertain review, or kept published by a failed one. */
  weak?: boolean
  /** Only facts about an entry, or a sense of an entry, whose lowest CEFR level is this. */
  level?: CefrLevel
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
   * old version could still publish. Curated facts are never marked.
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
   * batch; facts already marked keep their mark, and curated facts are never marked.
   */
  rereview?: Rereview
}

export interface FactRepo {
  find(id: FactId): Promise<Fact | null>
  findLive(kind: FactKind, subjectId: EntryId | SenseId, contentKey: string): Promise<Fact | null>
  /** The live facts of a kind about a subject, oldest first. */
  listLive(kind: FactKind, subjectId: EntryId | SenseId): Promise<Fact[]>
  /** The live facts of a linking kind whose subject and target senses belong one to each of the two entries. */
  listLiveLinks<K extends FactKind>(kind: K, between: readonly [EntryId, EntryId]): Promise<Link<K>[]>
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
  /**
   * The latest rejected facts of these kinds about this node (as subject or object), most recently
   * rejected first, leaving out any whose content a live fact of its kind about the same subject holds.
   */
  listRejected(nodeId: EntryId | SenseId, kinds: readonly FactKind[], limit: number): Promise<Fact[]>
  /**
   * The latest rejected word formations of other entries with a base part naming this lemma, each
   * with its entry's lemma, most recently rejected first, leaving out any whose content a live
   * fact of its kind about the same entry holds.
   */
  listRejectedDerivations(
    baseLemma: string,
    limit: number,
  ): Promise<Array<{ word: string; fact: FactOf<'morphology'> }>>
  /** Live facts about this node (as subject or object) marked for a review against its new version. */
  listRevalidating(nodeId: EntryId | SenseId): Promise<FactId[]>
  /** Facts pending since before cutoff, then facts awaiting revalidation since before it, pending first. */
  listStuckBefore(cutoff: string, limit: number): Promise<FactId[]>
  /** A rejected fact of this kind about this subject with this content that a curator rejected. */
  findCuratedRejection(kind: FactKind, subjectId: EntryId | SenseId, contentKey: string): Promise<Fact | null>
  /** The fact with the entry its subject is or belongs to. */
  findWithEntry(id: FactId): Promise<WithEntry<Fact> | null>
  /** Facts the filter admits, newest first, each with the entry its subject is or belongs to. */
  list(filter: FactFilter, page: PageRequest): Promise<Page<WithEntry<Fact>>>
  countByKindAndStatus(): Promise<Array<{ kind: FactKind; status: FactStatus; count: number }>>
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

/** A member of a category as the view stores it: its sense summary and how far below the category it is. */
export interface StoredMember {
  summary: StoredSenseSummary
  depth: number
}

/** Which public entries a list shows. */
export interface EntryFilter {
  /** The lemma starts with it; empty for any lemma. */
  prefix: string
  /**
   * A meaning of the entry, or with `leaves` a sense tagged with one of them, has one of these
   * levels (any when empty) and this part of speech (any when null).
   */
  levels: readonly CefrLevel[]
  pos: Pos | null
  /** Leaf topics one of its senses is tagged with; null for no topic filter. */
  leaves: readonly TopicId[] | null
}

/** A search: the exact query for the lemma tiers, the index terms it must all match, and the scopes to match them in. */
export interface SearchQuery {
  text: string
  /** Empty when the query has no word to match in a text, so only lemmas can match. */
  terms: readonly string[]
  /** en, and the language of the read when it has one. */
  scopes: readonly string[]
}

export interface SearchRow {
  summary: StoredSummary
  match: SearchMatch
}

/** The public view: each entry's public document and the lookup rows derived from it. */
export interface PublicViewRepo {
  /** The view of the entry with exactly this lemma and its links; null when no entry has it. */
  findByLemma(lemma: Lemma): Promise<EntryViewLookup | null>
  /** The view of the entry that owns this sense; null when no sense has the id. */
  findBySense(id: SenseId): Promise<ViewLookup | null>
  /** Built form rows spelled exactly so, in lemma order. */
  findForms(form: string): Promise<FormRow[]>
  /** Summaries of the built public entries the filter admits, by lemma or by frequency then lemma. */
  listEntries(filter: EntryFilter, sort: EntrySort, page: PageRequest): Promise<Page<StoredSummary>>
  /**
   * Built public senses tagged with one of these leaves, each once, by lemma, frequency, or level,
   * each then by lemma and sense.
   */
  listTaggedSenses(leaves: readonly TopicId[], sort: SenseSort, page: PageRequest): Promise<Page<StoredSenseSummary>>
  /**
   * Built public entries the query matches, each once at its best tier (`SEARCH_TIERS`), then by
   * frequency, then by lemma.
   */
  search(query: SearchQuery, page: PageRequest): Promise<Page<SearchRow>>
  /**
   * The public senses a broader-term walk from this sense reaches through everyday links, and the
   * links of `domain` when one is given, each once at its nearest depth, by depth, lemma, and id.
   */
  listMembers(id: SenseId, domain: RelationDomain | null, page: PageRequest): Promise<Page<StoredMember>>
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
  /** The item with the entry its target is or belongs to. */
  findWithEntry(id: FeedbackId): Promise<WithEntry<FeedbackRecord> | null>
  /** Items with the status, newest first, each with the entry its target is or belongs to. */
  list(filter: { status?: FeedbackStatus }, page: PageRequest): Promise<Page<WithEntry<FeedbackRecord>>>
  countByStatus(): Promise<Record<FeedbackStatus, number>>
}

/** A worklist row whose stored scores and items no longer describe the entry. */
export interface StaleWork {
  entryId: EntryId
  /** The revision a rescore describes once saved. */
  revision: number
}

export interface WorkScores {
  completeness: number
  quality: number
  slots: SlotCounts
}

/** A stored item with the lemma of its entry. */
export type WorkItemWithLemma = WorkItem & { lemma: Lemma }

export interface WorkRepo {
  /** Marks the entry as a seed entry; a repeat is a no-op. */
  markSeed(entryId: EntryId): Promise<void>
  /**
   * Stale rows of the entries that are, or own as a sense, these nodes, and of the entries whose
   * relations link to a sense that is or belongs to one of them.
   */
  listStale(nodeIds: string[]): Promise<StaleWork[]>
  /** Up to `limit` stale rows of any entry. */
  listAnyStale(limit: number): Promise<StaleWork[]>
  /** How many rows are stale. */
  countStale(): Promise<number>
  /** The entry's stored work items. */
  listItems(entryId: EntryId): Promise<WorkItem[]>
  /** The stored items with these ids; an id with no item is left out. */
  findItems(ids: readonly WorkItemId[]): Promise<WorkItem[]>
  /**
   * Stores the scores and brings the entry's items to `items` as of the stale revision, in one
   * batch: each write upserts by type and node, keeping a stored item's id, lease, and claim and
   * work records, and a new item gets a fresh id; each item's history row is inserted with it, its
   * gap refreshed, and stamped closed when the item is deleted; and each verdict settles the
   * attempts at its item still waiting on review. A no-op when another write bumped the revision since.
   */
  saveAssessment(stale: StaleWork, scores: WorkScores, items: ReconciledItems): Promise<void>
  /**
   * Leases up to `limit` free items of the production queue, all of the type of its first free
   * item (among `types` when given), in queue order, recording each one's gap as claimed, and
   * stores the lease; null when no item is free. An item whose lease expired is free.
   */
  claim(
    lease: Pick<WorkLease, 'id' | 'holder' | 'expiresAt'>,
    types: readonly WorkType[] | undefined,
    limit: number,
    now: string,
  ): Promise<{ lease: WorkLease; items: WorkItem[] } | null>
  findLease(id: WorkLeaseId): Promise<WorkLease | null>
  /**
   * While the lease is still held at `at`: records an attempt at each `worked` item (waiting on
   * review, or closed when the item is already gone) with the lease's time shared among them,
   * marks them worked with their notes, releases every item it holds, bumps the revision of its
   * entries, and deletes it; false when it is no longer held, changing nothing.
   */
  complete(lease: WorkLease, worked: ReadonlyArray<{ id: WorkItemId; note?: string }>, at: string): Promise<boolean>
  /** The curators' queue: items at the attempt bound, of `type` when given, in queue order. */
  listCuration(type: WorkType | null, page: PageRequest): Promise<Page<WorkItemWithLemma>>
  /** Deletes the leases that expired at or before `before`; returns how many. */
  purgeLeases(before: string): Promise<number>
}

/** A work item as the console reads it: open from `work_items`, or closed from its history row. */
export interface WorkItemRecord {
  id: WorkItemId
  entryId: EntryId
  lemma: Lemma
  type: WorkType
  subjectId: string
  /** The live gloss when the subject is a sense: the one no live correction supersedes. */
  senseGloss: string | null
  gap: Gap
  awaiting: boolean
  /** Completed passes that left it unchanged; 0 for a closed item. */
  attempts: number
  lease: { holder: PrincipalRef; expiresAt: string } | null
  createdAt: string
  /** Null while the item is open. */
  closedAt: string | null
}

/** One completed attempt at an item, with the facts its holder submitted about the item meanwhile. */
export interface WorkAttemptRecord {
  id: string
  itemId: WorkItemId
  /** 1-based, among the item's completed attempts in completion order. */
  ordinal: number
  entryId: EntryId
  lemma: Lemma
  type: WorkType
  subjectId: string
  senseGloss: string | null
  holder: PrincipalRef
  claimedAt: string
  completedAt: string
  seconds: number
  note: string | null
  outcome: WorkAttemptOutcome
  /**
   * Facts the holder authored between the claim and the completion about the item's node: the
   * entry and its senses for an entry's item, the sense for a sense's, and the weak fact's subject
   * for a weak fact.
   */
  facts: Fact[]
}

export interface WorkAttemptFilter {
  outcome?: WorkAttemptOutcome
  type?: WorkType
  holder?: PrincipalRef
  /** The item's entry has exactly this lemma. */
  lemma?: Lemma
}

/** Item counts by created and closed; each counts the items that opened or closed since the cutoff. */
export interface ItemFlow {
  created: number
  closed: number
}

/** Read-only aggregates over the facts, the worklist, and the work tables, for the console. */
export interface MonitorRepo {
  /** Weak facts by kind, as the facts list `weak` filter selects them. */
  countWeakByKind(): Promise<Array<{ kind: FactKind; count: number }>>
  countLiveFacts(): Promise<number>
  /** The worklist rows of live entries by `level_rank`: how many, how many complete, and their completeness summed. */
  completenessByLevel(): Promise<Array<{ levelRank: number | null; entries: number; complete: number; sum: number }>>
  /** Pending facts: how many, the oldest's creation, and how many were created before the cutoff. */
  pendingReview(before: string): Promise<{ count: number; oldestAt: string | null; olderThan: number }>
  /** Open items by type, level rank, and the inputs of their status. */
  countOpenItems(now: string): Promise<
    Array<{
      type: WorkType
      levelRank: number | null
      attempts: number
      awaiting: boolean
      /** Under a lease unexpired at `now`. */
      leased: boolean
      count: number
    }>
  >
  /** Leases that expired since the cutoff and before now: their holders never completed them. */
  countTimedOutLeases(since: string, now: string): Promise<number>
  /** Items created and closed since the cutoff, by type and level rank. */
  itemFlow(since: string): Promise<Array<ItemFlow & { type: WorkType; levelRank: number | null }>>
  /** Items created and closed since the cutoff, by the first `keyLength` characters of the timestamp. */
  throughput(since: string, keyLength: number): Promise<Array<ItemFlow & { key: string }>>
  /** The median seconds from created to closed of the items closed since the cutoff; null without one. */
  medianCloseSeconds(since: string): Promise<number | null>
  /** Attempts completed since the cutoff by type: their median seconds, how many settled, and how many of those closed or progressed. */
  attemptStats(
    since: string,
  ): Promise<Array<{ type: WorkType; medianSeconds: number; settled: number; succeeded: number }>>
  /** Up to `limit` leases expiring after the cutoff, newest claim first, each with its first three lemmas. */
  listLeases(since: string, limit: number): Promise<Array<WorkLease & { lemmas: Lemma[] }>>
  /** Distinct holders of a lease unexpired at `now`. */
  countHolders(now: string): Promise<number>
  /** Attempts the filter admits, latest completion first. */
  listAttempts(filter: WorkAttemptFilter, page: PageRequest): Promise<Page<WorkAttemptRecord>>
  /** Every attempt at the item, latest completion first. */
  listItemAttempts(itemId: WorkItemId): Promise<WorkAttemptRecord[]>
  /** The open items of the entry, or about the node, in queue order. */
  listOpenItems(by: { entryId: EntryId } | { subjectId: string }): Promise<WorkItemRecord[]>
  /** The item, open or closed; null when no item ever had the id. */
  findItem(id: WorkItemId): Promise<WorkItemRecord | null>
}

export interface AgentRecord {
  id: AgentId
  name: string
  curator: boolean
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

/** The period of every rate limit binding (wrangler.toml `ratelimits`), which a 429 reports as Retry-After. */
export const LIMIT_PERIOD_SECONDS = 60

export interface RateLimiter {
  /** False when this key has used up its allowance for the current period. */
  allow(key: string): Promise<boolean>
}

/**
 * A shared cache of whole HTTP responses by URL key, which keeps each for its own Cache-Control
 * max-age: the Workers Cache API at the edge.
 */
export interface ResponseCache {
  match(key: string): Promise<Response | undefined>
  put(key: string, response: Response): Promise<void>
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
