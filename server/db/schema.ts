import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  text: text('text').notNull(),
  createdAt: text('created_at').notNull(),
})

export type NoteRow = typeof notes.$inferSelect
