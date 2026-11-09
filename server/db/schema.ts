import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const entries = sqliteTable('entries', {
  id: text('id').primaryKey(),
  lemma: text('lemma').notNull().unique(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
})

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
    /** The kind's cardinality is `one`, copied from the registry so the slot indexes can see it. */
    exclusive: integer('exclusive', { mode: 'boolean' }).notNull(),
    supersedesId: text('supersedes_id'),
    author: text('author').notNull(),
    review: text('review'),
    /** When a correction of the gloss this fact was judged against published; null when settled. */
    revalidateSince: text('revalidate_since'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    // Resubmitting a live fact must find the existing one instead of duplicating it.
    // content_key precedes subject_id so lookups by content (forms) use the index too.
    uniqueIndex('facts_live_content_idx')
      .on(table.kind, table.contentKey, table.subjectId)
      .where(sql`status in ('pending', 'published')`),
    // An exclusive slot has one holder (the published fact, or a pending one that corrects
    // nothing) and at most one pending fact, so a pending correction may sit beside its original.
    uniqueIndex('facts_exclusive_holder_idx')
      .on(table.kind, table.subjectId)
      .where(sql`exclusive = 1 and (status = 'published' or (status = 'pending' and supersedes_id is null))`),
    uniqueIndex('facts_exclusive_pending_idx')
      .on(table.kind, table.subjectId)
      .where(sql`exclusive = 1 and status = 'pending'`),
    index('facts_subject_idx').on(table.subjectId, table.status),
    index('facts_object_idx').on(table.objectId),
    index('facts_status_created_idx').on(table.status, table.createdAt, table.id),
    index('facts_status_updated_idx').on(table.status, table.updatedAt),
    index('facts_revalidate_idx').on(table.revalidateSince).where(sql`revalidate_since is not null`),
  ],
)

export const feedback = sqliteTable(
  'feedback',
  {
    id: text('id').primaryKey(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    message: text('message').notNull(),
    status: text('status').notNull(),
    assignee: text('assignee'),
    claimExpiresAt: text('claim_expires_at'),
    resolutionNote: text('resolution_note'),
    resolutionFactIds: text('resolution_fact_ids').notNull(),
    revision: integer('revision').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('feedback_status_created_idx').on(table.status, table.createdAt, table.id)],
)

/**
 * One row per entry, created with it. `live` mirrors whether the entry fact is pending or
 * published, and `claim_rank` derives the claim tier from `claim_count`, `seed`, and `revisit`, so
 * the claim order is one index: an entry's second pass (rank 0), never-claimed seed entries (1),
 * seed entries to revisit (2), never-claimed other entries (3), other entries to revisit (4), and
 * the rotation of everything else (5).
 */
export const worklist = sqliteTable(
  'worklist',
  {
    entryId: text('entry_id')
      .primaryKey()
      .references(() => entries.id),
    createdAt: text('created_at').notNull(),
    live: integer('live', { mode: 'boolean' }).notNull(),
    /** Set by every claim, so an entry rotates to the back whether or not its work completes. */
    claimedAt: text('claimed_at'),
    claimCount: integer('claim_count').notNull().default(0),
    /** Set when an entry is submitted as part of a seed list; never cleared. */
    seed: integer('seed', { mode: 'boolean' }).notNull().default(false),
    /**
     * Cleared by every claim. Set when a completed pass added a fact about the entry and left gaps
     * open, or when a fact about it leaves live or it gains a sense, which can reopen a gap.
     */
    revisit: integer('revisit', { mode: 'boolean' }).notNull().default(false),
    claimRank: integer('claim_rank').generatedAlwaysAs(
      sql`case when claim_count = 1 then 0 when claim_count = 0 then 3 - 2 * seed when revisit then 4 - 2 * seed else 5 end`,
      { mode: 'virtual' },
    ),
    leaseId: text('lease_id').unique(),
    leaseHolder: text('lease_holder'),
    leaseExpiresAt: text('lease_expires_at'),
    lastWorkedAt: text('last_worked_at'),
    lastWorkedBy: text('last_worked_by'),
    lastNote: text('last_note'),
  },
  (table) => [
    index('worklist_claim_order_idx').on(table.live, table.claimRank, table.claimedAt, table.createdAt, table.entryId),
    check(
      'worklist_lease_whole',
      sql`(${table.leaseId} is null) = (${table.leaseHolder} is null) and (${table.leaseId} is null) = (${table.leaseExpiresAt} is null)`,
    ),
  ],
)

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
})

export type FactRow = typeof facts.$inferSelect
export type FeedbackRow = typeof feedback.$inferSelect
export type AgentRow = typeof agents.$inferSelect
