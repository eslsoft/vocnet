import type { EntrySnapshot, StoredSenseSummary, StoredSummary } from '@server/domain/catalog-view'
import type { Fact, FactOf } from '@server/domain/fact'
import type { DecisionModel, JevQuestions, Link, LlmPrompt } from '@server/domain/fact-kinds'
import type { EntryNode, SenseNode, SenseWithLemma, SentenceNode, SentenceUses } from '@server/domain/nodes'
import type { PrincipalRef } from '@server/domain/principal'
import type { EntryLinks, PublicViewRecord } from '@server/domain/public-view'
import type { Lemma } from '@server/domain/term'
import type { TicketRecord } from '@server/domain/tickets'
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
  SentenceId,
  TopicId,
  Verdict,
} from '@shared/facts'
import type { WorkAttemptOutcome } from '@shared/monitor'
import type { CefrLevel, LemmaReference, ReferenceSource } from '@shared/reference'
import type { ServiceId } from '@shared/services'
import type { TicketId, TicketStatus, TicketType } from '@shared/tickets'
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
  /** The entries with these ids; an id with no entry is left out. */
  findEntries(ids: readonly EntryId[]): Promise<EntryNode[]>
  /** The entries spelled exactly as these lemmas; a lemma with no entry is left out. */
  findEntriesByLemmas(lemmas: readonly Lemma[]): Promise<EntryNode[]>
  /**
   * Creates the entries these lemmas have none of, not live (their worklist rows say so), and
   * returns the stored entry of every lemma in order; a concurrent create converges on one row.
   */
  ensureEntries(lemmas: readonly Lemma[], createdBy: PrincipalRef, now: string): Promise<EntryNode[]>
  /** The published phrases lists that name this entry as an entry item, oldest first. */
  listNamingLists(entryId: EntryId): Promise<FactId[]>
  findSentence(id: SentenceId): Promise<SentenceNode | null>
  /** The sentences with these ids; an id with no sentence is left out. */
  findSentences(ids: readonly SentenceId[]): Promise<SentenceNode[]>
  /** The sentences whose text key is one of these texts' (`textKey`). */
  findSentencesByTexts(texts: readonly string[]): Promise<SentenceNode[]>
  /**
   * Inserts the sentences whose text key no row has and returns the stored row of every given
   * sentence in order, so a concurrent create converges on one row.
   */
  insertSentences(sentences: readonly SentenceNode[]): Promise<SentenceNode[]>
  /** The live examples and live phrases lists that name the sentence. */
  listSentenceUses(id: SentenceId): Promise<SentenceUses>
  findSense(id: SenseId): Promise<SenseWithLemma | null>
  /** The sense rows of the entry, oldest first. */
  listSenses(entryId: EntryId): Promise<SenseNode[]>
  /** Inserts these senses of one entry (each with its creation key) unless one with its key exists; returns the stored rows in order. */
  insertSenses(senses: ReadonlyArray<{ sense: SenseNode; creationKey: string }>): Promise<SenseNode[]>
  /** Whether the entry is admitted (an imported headword or a listed phrase), and its batch. */
  admission(entryId: EntryId): Promise<{ live: boolean; batch: number | null }>
  /**
   * Admits the entries with these lemmas in the batch: creates the missing ones, marks every one
   * live with the batch (an admitted entry keeps its earlier batch), and bumps their revisions.
   */
  admit(lemmas: readonly Lemma[], batch: number, createdBy: PrincipalRef, now: string): Promise<EntryNode[]>
  /**
   * Sets which of these phrase entries are live: a phrase is live while a published phrases list
   * names it. `batch` is the batch the live ones join. Bumps the revision of every entry it changes.
   */
  setPhrasesLive(live: readonly EntryId[], dead: readonly EntryId[], batch: number | null): Promise<void>
  /** Published phrases lists that name a phrase with no live entry, oldest first: their admission did not finish. */
  listUnadmittedPhraseLists(limit: number): Promise<FactId[]>
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
  /** Only entries with an item that became a ticket. */
  stuck: boolean
}

/** Imported reference data, read by exact lemma spelling. */
export interface ReferenceRepo {
  forLemma(lemma: Lemma): Promise<LemmaReference>
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
   * The write applies only while the fact's subject holds fewer than `max` live facts of its kind,
   * not counting `excluding` (the fact a correction supersedes), counted in the same statement.
   */
  liveBelow?: { max: number; excluding: FactId | null }
  /** The write applies only while no live fact supersedes this one, checked in the same statement. */
  unsuperseded?: boolean
  /** The write applies only while this fact (the original a correction supersedes) is published, checked in the same statement. */
  originalPublished?: FactId
}

export interface FactRepo {
  find(id: FactId): Promise<Fact | null>
  findLive(kind: FactKind, subjectId: string, contentKey: string): Promise<Fact | null>
  /** A rejected fact of this kind about this subject with this content; the latest one. */
  findRejected(kind: FactKind, subjectId: string, contentKey: string): Promise<Fact | null>
  /** The live facts of a kind about a subject, oldest first. */
  listLive(kind: FactKind, subjectId: string): Promise<Fact[]>
  /** The live facts of a linking kind whose subject and target senses belong one to each of the two entries. */
  listLiveLinks<K extends FactKind>(kind: K, between: readonly [EntryId, EntryId]): Promise<Link<K>[]>
  /** The live (pending or published) correction that supersedes this fact, if any. */
  findLiveCorrection(id: FactId): Promise<Fact | null>
  /**
   * Inserts unless a live fact holds the same (kind, subject, content key) and returns the live
   * fact either way; null when another live fact holds the fact's slot, the subject
   * already holds the kind's `maxLive` live facts (not counting the fact this one supersedes), or
   * this correction's original is not published or already has a live correction.
   */
  insert(fact: Fact): Promise<Fact | null>
  /**
   * Conditional status write; false when the fact was not in `from`. Throws ConflictError when the
   * slot is taken or the original already has another live correction.
   */
  transition(write: FactTransitionWrite): Promise<boolean>
  /**
   * Facts pending since before cutoff and not re-enqueued since then, oldest first, stamped as
   * re-enqueued at `at`, so the next call skips them until another interval has passed.
   */
  claimStuckBefore(cutoff: string, limit: number, at: string): Promise<FactId[]>
  /** A rejected fact of this kind about this subject with this content that a curator rejected. */
  findCuratedRejection(kind: FactKind, subjectId: string, contentKey: string): Promise<Fact | null>
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
  /** The senses it is a direct kind of within the walk: the category or other members, by id. */
  parents: SenseId[]
}

/** A tagged sense as the view stores it: its sense summary and whether its entry's inventory ranks it extra. */
export interface StoredTaggedSense {
  summary: StoredSenseSummary
  rare: boolean
}

/** What a topic or a category lists: its public senses, each once, and the entries with a common one. */
export interface TopicCount {
  topicId: TopicId
  senses: number
  entries: number
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
  listTaggedSenses(leaves: readonly TopicId[], sort: SenseSort, page: PageRequest): Promise<Page<StoredTaggedSense>>
  /** What every leaf topic with a tagged public sense lists, and every category over its leaves. */
  countTagged(): Promise<TopicCount[]>
  /** The stored documents of the built public entries spelled exactly as these lemmas, in any order. */
  findDocuments(lemmas: readonly Lemma[]): Promise<string[]>
  /**
   * Built public entries the query matches, each once at its best tier (`SEARCH_TIERS`), then by
   * frequency, then by lemma.
   */
  search(query: SearchQuery, page: PageRequest): Promise<Page<SearchRow>>
  /**
   * The public senses a broader-term walk from this sense reaches through everyday links, and the
   * links of `domain` when one is given, each once at its nearest depth, by depth, lemma, and id,
   * with how many the walk reaches in all.
   */
  listMembers(
    id: SenseId,
    domain: RelationDomain | null,
    page: PageRequest,
  ): Promise<Page<StoredMember> & { total: number }>
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

export interface TicketRepo {
  /** Inserts unless the target already has an open ticket of the type; returns the stored open ticket either way. */
  open(ticket: TicketRecord): Promise<TicketRecord>
  find(id: TicketId): Promise<TicketRecord | null>
  /** Compare-and-set on revision; false when someone else wrote first. */
  update(next: TicketRecord, expectedRevision: number): Promise<boolean>
  /** The ticket with the entry its target is or belongs to; null entry for a missing word. */
  findWithEntry(id: TicketId): Promise<(TicketRecord & { entry: { id: EntryId; lemma: Lemma } | null }) | null>
  /** Tickets the filter admits, oldest open first, each with the entry its target is or belongs to. */
  list(
    filter: { status?: TicketStatus; type?: TicketType },
    page: PageRequest,
  ): Promise<Page<TicketRecord & { entry: { id: EntryId; lemma: Lemma } | null }>>
  countByStatus(): Promise<Record<TicketStatus, number>>
}

/** A worklist row whose stored scores and items no longer describe the entry. */
export interface StaleWork {
  entryId: EntryId
  /** The revision a rescore describes once saved. */
  revision: number
}

export interface WorkScores {
  completeness: number
  credibility: number
  slots: SlotCounts
}

/** A stored item with the lemma of its entry. */
export type WorkItemWithLemma = WorkItem & { lemma: Lemma }

export interface WorkRepo {
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
   * attempts at its item still waiting on review. A `passed` verdict records the item's pass (its
   * last note and holder) so the slot counts as filled; a `stuck` one opens a stuck_work ticket on
   * the item's node. A no-op when another write bumped the revision since.
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
   * marks them worked with their notes and whether they found none, records the lemmas a pass was
   * blocked on, releases every item it holds, bumps the revision of its entries, and deletes it;
   * false when it is no longer held, changing nothing.
   */
  complete(
    lease: WorkLease,
    worked: ReadonlyArray<{ id: WorkItemId; note?: string; foundNone: boolean; blockedOn: readonly string[] }>,
    at: string,
  ): Promise<boolean>
  /**
   * A curator settles a slot by hand: records a pass on it (any gap type) and bumps the entry's
   * revision so its rescore counts the slot filled.
   */
  recordPass(pass: {
    entryId: EntryId
    type: WorkType
    subjectId: string
    note: string
    holder: PrincipalRef
    at: string
  }): Promise<void>
  /** Deletes the passes blocked on these lemmas and bumps their entries' revisions, so their slots are worked again. */
  reopenBlocked(lemmas: readonly Lemma[]): Promise<EntryId[]>
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
  /** Published facts by kind and the credibility of their review path, for the console's audit view. */
  countByCredibility(): Promise<Array<{ kind: FactKind; reviewer: string | null; count: number }>>
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
  /** When the history began recording: the earliest creation it saw (not backfilled) or close; null when empty. */
  historySince(): Promise<string | null>
  /** Items created (not backfilled) and closed since the cutoff, by type and level rank. */
  itemFlow(since: string): Promise<Array<ItemFlow & { type: WorkType; levelRank: number | null }>>
  /** Items created (not backfilled) and closed since the cutoff, by the first `keyLength` characters of the timestamp. */
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

export interface ServiceRecord {
  id: ServiceId
  name: string
  createdBy: PrincipalRef
  createdAt: string
  revokedAt: string | null
}

export interface ServiceRepo {
  insert(service: ServiceRecord, keyHash: string): Promise<void>
  find(id: ServiceId): Promise<ServiceRecord | null>
  findByKeyHash(keyHash: string): Promise<ServiceRecord | null>
  list(): Promise<ServiceRecord[]>
  revoke(id: ServiceId, at: string): Promise<void>
}

export interface DecisionAnswers {
  model: string
  /** Probability per question key, in [0, 1]. */
  answers: Record<string, number>
}

/** A decision model (Jev, luna) scores yes/no questions about labelled data. */
export interface DecisionReviewer {
  ask(questions: JevQuestions, state: Readonly<Record<string, string | readonly string[]>>): Promise<DecisionAnswers>
}

export type DecisionReviewers = Readonly<Record<DecisionModel, DecisionReviewer>>

export interface LlmJudgement {
  model: string
  verdict: Verdict
  confidence: number
  reason: string
}

export interface LlmReviewer {
  judge(prompt: LlmPrompt): Promise<LlmJudgement>
  /** The JSON object the LLM answers the prompt with, undecoded: the caller decodes it against its own contract. */
  answer(prompt: LlmPrompt): Promise<{ model: string; answer: unknown }>
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
  sentence(): SentenceId
  fact(): FactId
  ticket(): TicketId
  agent(): AgentId
  service(): ServiceId
  lease(): WorkLeaseId
}
