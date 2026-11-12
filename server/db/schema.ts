import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

export const entries = sqliteTable(
  'entries',
  {
    id: text('id').primaryKey(),
    lemma: text('lemma').notNull().unique(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
  /** The case-variant lookup: the other entries spelled like a lemma but for letter case. */
  (table) => [index('entries_lemma_case_idx').on(sql`lower(${table.lemma})`)],
)

export const senses = sqliteTable(
  'senses',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id),
    pos: text('pos').notNull(),
    /** Meaning key of the gloss the sense was created with, without labels, so a concurrent duplicate create finds it. */
    creationKey: text('creation_key').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('senses_entry_idx').on(table.entryId),
    uniqueIndex('senses_creation_idx').on(table.entryId, table.pos, table.creationKey),
  ],
)

export const facts = sqliteTable(
  'facts',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    subjectId: text('subject_id').notNull(),
    objectId: text('object_id'),
    contentKey: text('content_key').notNull(),
    payload: text('payload').notNull(),
    status: text('status').notNull(),
    /**
     * The slot the fact holds on its subject (`slotOf` in the registry): one live fact per kind,
     * subject, and slot. The empty string for a kind with one live fact per subject, the language
     * for a translation, null for a kind without the limit.
     */
    slot: text('slot'),
    supersedesId: text('supersedes_id'),
    author: text('author').notNull(),
    review: text('review'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    // Resubmitting a live fact must find the existing one instead of duplicating it.
    // content_key precedes subject_id so lookups by content (forms) use the index too.
    uniqueIndex('facts_live_content_idx')
      .on(table.kind, table.contentKey, table.subjectId)
      .where(sql`status in ('pending', 'published')`),
    // A slot has one holder (the published fact, or a pending one that corrects nothing) and at
    // most one pending fact, so a pending correction may sit beside its original.
    uniqueIndex('facts_slot_holder_idx')
      .on(table.kind, table.subjectId, table.slot)
      .where(sql`slot is not null and (status = 'published' or (status = 'pending' and supersedes_id is null))`),
    uniqueIndex('facts_slot_pending_idx')
      .on(table.kind, table.subjectId, table.slot)
      .where(sql`slot is not null and status = 'pending'`),
    // A fact has at most one live correction, so each live correction takes a distinct original's place.
    uniqueIndex('facts_live_correction_idx')
      .on(table.supersedesId)
      .where(sql`supersedes_id is not null and status in ('pending', 'published')`),
    index('facts_subject_idx').on(table.subjectId, table.status),
    index('facts_object_idx').on(table.objectId),
    index('facts_status_created_idx').on(table.status, table.createdAt, table.id),
    index('facts_status_updated_idx').on(table.status, table.updatedAt),
    // Resubmitting rejected content is refused by looking the rejection up.
    index('facts_rejected_content_idx')
      .on(table.kind, table.subjectId, table.contentKey)
      .where(sql`status = 'rejected'`),
  ],
)

/**
 * One row per thing a curator handles by hand: a stuck work item, a reader's feedback, an audit
 * pick, or a missing word. A target has at most one open ticket of each type, so raising it again
 * finds the open one.
 */
export const tickets = sqliteTable(
  'tickets',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    targetType: text('target_type').notNull(),
    /** The entry, sense, or fact id, or the missing lemma. */
    target: text('target').notNull(),
    message: text('message').notNull(),
    status: text('status').notNull(),
    resolutionNote: text('resolution_note'),
    resolutionFactIds: text('resolution_fact_ids').notNull(),
    revision: integer('revision').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('tickets_open_target_idx').on(table.type, table.targetType, table.target).where(sql`status = 'open'`),
    index('tickets_status_created_idx').on(table.status, table.createdAt, table.id),
    index('tickets_target_idx').on(table.target, table.status),
  ],
)

/**
 * One row per entry, created with it. `live` is whether the entry is admitted: an imported
 * headword, or a phrase a published phrases list names. `batch` is the headword batch it belongs
 * to (a phrase takes its headword's). `completeness` and `credibility` are computed by
 * `assessEntry` in server/domain/work.ts as
 * of `scored_revision`, for stats and the console; the work itself is the entry's `work_items`.
 * Every write that can change the entry's work bumps `revision` in its own batch, and the use case
 * that made it rescores, which rewrites the scores and the items together. A stale row
 * (`revision <> scored_revision`) keeps its items as of the last rescore until the cron drains it.
 * `level_rank` and `zipf` are the learner priority of the entry's lemma, read from the reference
 * tables when the row is created and again by every reference import.
 */
export const worklist = sqliteTable(
  'worklist',
  {
    entryId: text('entry_id')
      .primaryKey()
      .references(() => entries.id),
    createdAt: text('created_at').notNull(),
    live: integer('live', { mode: 'boolean' }).notNull(),
    /** The headword batch the entry was imported in, or its headword's for a phrase; null while it is not live. */
    batch: integer('batch'),
    /**
     * `frequencyKey` of the entry's lemma, so SQL reads its frequency under the key the domain
     * defines. Every insert sets it; it is nullable only because SQLite cannot add a NOT NULL
     * column without a default to a table with rows.
     */
    frequencyKey: text('frequency_key'),
    /** `levelRank` of the lowest CEFR level of the entry's exact lemma; null when it has none. */
    levelRank: integer('level_rank'),
    /** The Zipf frequency of the entry's lemma; null when the frequency list has none. */
    zipf: real('zipf'),
    completeness: real('completeness').notNull().default(0),
    credibility: real('credibility').notNull().default(1),
    /** `slots` of the assessment as of `scored_revision`: counted, filled by published facts, filled only by pending ones. */
    slotsTotal: integer('slots_total').notNull().default(0),
    slotsPublished: integer('slots_published').notNull().default(0),
    slotsPending: integer('slots_pending').notNull().default(0),
    revision: integer('revision').notNull().default(0),
    scoredRevision: integer('scored_revision').notNull().default(0),
    /** The revision the entry's public view rows describe; behind `revision` while they are stale. */
    viewRevision: integer('view_revision').notNull().default(0),
    /** When a pass over an item of the entry last completed. */
    lastWorkedAt: text('last_worked_at'),
  },
  (table) => [
    index('worklist_stale_idx').on(table.entryId).where(sql`revision <> scored_revision`),
    index('worklist_view_stale_idx').on(table.entryId).where(sql`revision <> view_revision`),
  ],
)

/**
 * One row per piece of open work: a gap of an entry or of one of its senses, or a weak fact. The
 * rescore of the entry writes them (`reconcileItems` in server/domain/work.ts): it upserts the open
 * ones by `(type, subject_id)` and deletes the rest. `rank` is the priority policy's stage times
 * the band count plus the learner band; `zipf_order` the entry's Zipf frequency, -1 without one.
 * An item is in the production queue while it does not await a review and has fewer than two
 * attempts (`MAX_PASSES`); at two it is a ticket.
 */
export const workItems = sqliteTable(
  'work_items',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id),
    type: text('type').notNull(),
    /** The entry, the sense, or the weak fact the item is about. */
    subjectId: text('subject_id').notNull(),
    /** The gap as the wire shows it, as JSON. */
    gap: text('gap').notNull(),
    stage: integer('stage').notNull(),
    rank: integer('rank').notNull(),
    zipfOrder: real('zipf_order').notNull(),
    /** A pending fact changes the gap, so it waits for that review before it is worked or judged. */
    awaiting: integer('awaiting', { mode: 'boolean' }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    /** A completed pass worked the item while it awaited review; the settled gap decides the attempt. */
    worked: integer('worked', { mode: 'boolean' }).notNull().default(false),
    /** That pass found no value for its optional slot (`found_none`). */
    foundNone: integer('found_none', { mode: 'boolean' }).notNull().default(false),
    /** The gap when the item was last claimed, as JSON. */
    claimedGap: text('claimed_gap'),
    leaseId: text('lease_id'),
    leaseHolder: text('lease_holder'),
    leaseExpiresAt: text('lease_expires_at'),
    lastWorkedAt: text('last_worked_at'),
    lastWorkedBy: text('last_worked_by'),
    lastNote: text('last_note'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('work_items_subject_idx').on(table.type, table.subjectId),
    index('work_items_entry_idx').on(table.entryId),
    index('work_items_lease_idx').on(table.leaseId).where(sql`lease_id is not null`),
    // The production queue in claim order, across types and within one.
    index('work_items_queue_idx')
      .on(table.rank, sql`${table.zipfOrder} desc`, table.createdAt, table.id)
      .where(sql`awaiting = 0 and attempts < 2`),
    index('work_items_type_queue_idx')
      .on(table.type, table.rank, sql`${table.zipfOrder} desc`, table.createdAt, table.id)
      .where(sql`awaiting = 0 and attempts < 2`),
    check(
      'work_items_lease_whole',
      sql`(${table.leaseId} is null) = (${table.leaseHolder} is null) and (${table.leaseId} is null) = (${table.leaseExpiresAt} is null)`,
    ),
  ],
)

/**
 * One row per optional slot a pass completed without finding a value (`found_none`): the slot
 * counts as filled. `blocked_on` lists the lemmas that would fill it but were not live entries;
 * importing one deletes the pass so the slot is worked again.
 */
export const workPasses = sqliteTable(
  'work_passes',
  {
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id),
    type: text('type').notNull(),
    subjectId: text('subject_id').notNull(),
    note: text('note').notNull(),
    holder: text('holder').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.type, table.subjectId] }), index('work_passes_entry_idx').on(table.entryId)],
)

/** One row per lemma a pass was blocked on, so importing the lemma reopens the slot. */
export const workPassBlocks = sqliteTable(
  'work_pass_blocks',
  {
    lemma: text('lemma').notNull(),
    type: text('type').notNull(),
    subjectId: text('subject_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.lemma, table.type, table.subjectId] }),
    index('work_pass_blocks_slot_idx').on(table.type, table.subjectId),
  ],
)

/** One row per claim: what it leased, to whom, until when. Completing it deletes it. */
export const workLeases = sqliteTable(
  'work_leases',
  {
    id: text('id').primaryKey(),
    holder: text('holder').notNull(),
    type: text('type').notNull(),
    /** JSON arrays of the entry and item ids the claim leased. */
    entryIds: text('entry_ids').notNull(),
    itemIds: text('item_ids').notNull(),
    claimedAt: text('claimed_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [index('work_leases_expires_idx').on(table.expiresAt)],
)

/**
 * One row per work item ever opened, kept after the item closes: the console's task history. The
 * rescore inserts it with the item, refreshes `gap` while the item stays open, and stamps
 * `closed_at` when it deletes the item, each in its own conditional batch.
 */
export const workItemLog = sqliteTable(
  'work_item_log',
  {
    /** The work item's id. */
    id: text('id').primaryKey(),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id),
    type: text('type').notNull(),
    subjectId: text('subject_id').notNull(),
    /** The latest gap as the wire shows it, as JSON: the open one, or the last one a closed item had. */
    gap: text('gap').notNull(),
    createdAt: text('created_at').notNull(),
    /** When the rescore deleted the item; null while it is open. */
    closedAt: text('closed_at'),
    /**
     * The history migration copied the row from an item that was already open, so its creation
     * predates the log and does not count as created work.
     */
    backfilled: integer('backfilled', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    index('work_item_log_created_idx').on(table.createdAt),
    // The first creation the history recorded, past the rows the migration backfilled.
    index('work_item_log_recorded_idx').on(table.createdAt).where(sql`backfilled = 0`),
    index('work_item_log_closed_idx').on(table.closedAt).where(sql`closed_at is not null`),
    index('work_item_log_subject_idx').on(table.subjectId),
  ],
)

/**
 * One row per item a completion named: who worked it, from the claim to the completion, with the
 * lease's time shared among the items named. The completion inserts it `waiting_on_review` (or
 * `closed` when the pass's own facts already closed the item), and the rescore that judges the
 * item settles every waiting attempt at it (`reconcileItems` verdicts).
 */
export const workAttempts = sqliteTable(
  'work_attempts',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id').notNull(),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id),
    type: text('type').notNull(),
    subjectId: text('subject_id').notNull(),
    holder: text('holder').notNull(),
    leaseId: text('lease_id').notNull(),
    claimedAt: text('claimed_at').notNull(),
    completedAt: text('completed_at').notNull(),
    seconds: real('seconds').notNull(),
    note: text('note'),
    outcome: text('outcome').notNull(),
    settledAt: text('settled_at'),
  },
  (table) => [
    index('work_attempts_completed_idx').on(table.completedAt, table.id),
    index('work_attempts_item_idx').on(table.itemId, table.outcome),
    check(
      'work_attempts_outcome',
      sql`${table.outcome} in ('waiting_on_review', 'closed', 'passed', 'progressed', 'no_progress', 'stuck')`,
    ),
  ],
)

// The public view: each entry's public document, projected from its facts by
// `projectPublicEntry` in server/domain/catalog-view.ts and rebuilt whenever the worklist row's
// `revision` moves past `view_revision`. Derived data only: a row can be dropped and rebuilt from
// the facts, the topics, and the reference tables at any time. An entry without a public document
// has no rows. Every row derives from the entry's own document, so a rebuild touches only its rows.

/**
 * The stored document (every language and review), its digest for the ETag, the entry's summary,
 * and where it sorts by frequency (its frequency rank, else after every ranked entry).
 */
export const publicEntries = sqliteTable(
  'public_entries',
  {
    entryId: text('entry_id')
      .primaryKey()
      .references(() => entries.id),
    lemma: text('lemma').notNull().unique(),
    document: text('document').notNull(),
    digest: text('digest').notNull(),
    summary: text('summary').notNull(),
    frequencyOrder: integer('frequency_order').notNull(),
    builtAt: text('built_at').notNull(),
  },
  (table) => [index('public_entries_frequency_idx').on(table.frequencyOrder, table.lemma)],
)

/** One row per meaning of a public entry, so lists filter by part of speech and CEFR level. */
export const publicMeanings = sqliteTable(
  'public_meanings',
  {
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id),
    pos: text('pos').notNull(),
    cefr: text('cefr'),
  },
  (table) => [primaryKey({ columns: [table.entryId, table.pos] })],
)

/** One row per published form of a public entry, shown or not, by its spelling, with the part of speech it is shown under (else its label). */
export const publicForms = sqliteTable(
  'public_forms',
  {
    form: text('form').notNull(),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id),
    type: text('type').notNull(),
    pos: text('pos'),
  },
  (table) => [index('public_forms_form_idx').on(table.form), index('public_forms_entry_idx').on(table.entryId)],
)

/**
 * One row per published topic tag of a public sense, with the sense's part of speech and level and
 * its entry's frequency order, in each order a topic listing pages.
 */
export const publicSenseTopics = sqliteTable(
  'public_sense_topics',
  {
    topicId: text('topic_id').notNull(),
    lemma: text('lemma').notNull(),
    senseId: text('sense_id').notNull(),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id),
    pos: text('pos').notNull(),
    cefr: text('cefr'),
    levelOrder: integer('level_order').notNull(),
    frequencyOrder: integer('frequency_order').notNull(),
    summary: text('summary').notNull(),
    /** The sense is in the extra senses of its entry's published sense list. */
    rare: integer('rare', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.topicId, table.lemma, table.senseId] }),
    index('public_sense_topics_frequency_idx').on(table.topicId, table.frequencyOrder, table.lemma, table.senseId),
    index('public_sense_topics_level_idx').on(table.topicId, table.levelOrder, table.lemma, table.senseId),
    // An entry list by topic checks one common tagged sense per entry: entry, rarity, then topic.
    index('public_sense_topics_entry_idx').on(table.entryId, table.rare, table.topicId),
  ],
)

/**
 * One row per distinct gloss, translation, and example of a public entry's senses: `scope` is en
 * for English text and the language tag of a translation, `body` the text as the index stores it
 * (server/domain/search.ts). The FTS5 table `public_search_fts` indexes `body` with this table as
 * its external content, kept in step by triggers (migration 20261110034927_public_search_fts).
 */
export const publicSearch = sqliteTable(
  'public_search',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id),
    field: text('field').notNull(),
    scope: text('scope').notNull(),
    body: text('body').notNull(),
  },
  (table) => [index('public_search_entry_idx').on(table.entryId)],
)

/**
 * One row per broader term a public sense shows, everyday or of a domain, with the narrower
 * sense's summary, so a category lists its members by walking these rows down from it.
 */
export const publicHypernyms = sqliteTable(
  'public_hypernyms',
  {
    broaderSenseId: text('broader_sense_id').notNull(),
    senseId: text('sense_id').notNull(),
    /** The specialist taxonomy of the link; null in the everyday layer. */
    domain: text('domain'),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id),
    lemma: text('lemma').notNull(),
    summary: text('summary').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.broaderSenseId, table.senseId] }),
    index('public_hypernyms_sense_idx').on(table.senseId),
    index('public_hypernyms_entry_idx').on(table.entryId),
  ],
)

/** One row per part of a public entry's word formation, so entries sharing a base or root find each other. */
export const publicMorphemes = sqliteTable(
  'public_morphemes',
  {
    form: text('form').notNull(),
    role: text('role').notNull(),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id),
  },
  (table) => [
    primaryKey({ columns: [table.form, table.role, table.entryId] }),
    index('public_morphemes_entry_idx').on(table.entryId),
  ],
)

/**
 * The two-level topic taxonomy: a category has no parent, a leaf topic has its category as parent.
 * Admin-curated: rows change only by migration. Ids are stable; names are display labels.
 */
export const topics = sqliteTable(
  'topics',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id').references((): AnySQLiteColumn => topics.id),
    nameEn: text('name_en').notNull(),
    nameZh: text('name_zh').notNull(),
    /** Display order among the topic's siblings. */
    position: integer('position').notNull(),
  },
  (table) => [index('topics_parent_idx').on(table.parentId, table.position)],
)

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  /** Granted only by an admin at issue: the agent may settle facts and publish its own without review. */
  curator: integer('curator', { mode: 'boolean' }).notNull().default(false),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
})

// Reference data imported by scripts/reference/, keyed by spelling and independent of entries,
// so an import never depends on which entries exist. CEFR is read by exact lemma, frequency by
// the lemma's frequency key (domain/reference.ts).

export const referenceSources = sqliteTable('reference_sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  license: text('license').notNull(),
  licenseUrl: text('license_url').notNull(),
  changes: text('changes').notNull(),
  attribution: text('attribution').notNull(),
  url: text('url').notNull(),
  retrievedAt: text('retrieved_at').notNull(),
})

export const wordFrequency = sqliteTable('word_frequency', {
  word: text('word').primaryKey(),
  zipf: real('zipf').notNull(),
  rank: integer('rank').notNull(),
  sourceId: text('source_id')
    .notNull()
    .references(() => referenceSources.id),
})

export const lemmaCefr = sqliteTable(
  'lemma_cefr',
  {
    lemma: text('lemma').notNull(),
    pos: text('pos').notNull(),
    level: text('level').notNull(),
    sourceId: text('source_id')
      .notNull()
      .references(() => referenceSources.id),
  },
  (table) => [
    primaryKey({ columns: [table.lemma, table.pos] }),
    check('lemma_cefr_level', sql`${table.level} in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')`),
  ],
)

export type FactRow = typeof facts.$inferSelect
export type TicketRow = typeof tickets.$inferSelect
export type AgentRow = typeof agents.$inferSelect
export type TopicRow = typeof topics.$inferSelect
