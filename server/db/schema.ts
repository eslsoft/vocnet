import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('senses_entry_idx').on(table.entryId)],
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
    index('facts_subject_idx').on(table.subjectId, table.status),
    index('facts_object_idx').on(table.objectId),
    index('facts_status_created_idx').on(table.status, table.createdAt, table.id),
    index('facts_status_updated_idx').on(table.status, table.updatedAt),
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
