import { entries, facts, senses, type TicketRow, tickets } from '@server/db/schema'
import type { Lemma } from '@server/domain/term'
import type { TicketRecord } from '@server/domain/tickets'
import type { TicketRepo } from '@server/usecases/ports'
import type { EntryId } from '@shared/facts'
import { ticketStatusSchema } from '@shared/tickets'
import { and, asc, count, eq, gt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { type Db, decodeCursor, fromTicket, page, toTicket } from './rows'

const ticketCursor = z.object({ created_at: z.string(), id: z.string() })

/**
 * Tickets joined to the entry their target is or belongs to: a fact through its subject (a sense,
 * an entry, or the example or collocation a translation is about), a sense through its entry. A
 * missing word has none.
 */
function withEntry(db: Db) {
  const fact = facts
  return db
    .select({ ticket: tickets, entryId: entries.id, lemma: entries.lemma })
    .from(tickets)
    .leftJoin(fact, and(eq(tickets.targetType, 'fact'), eq(fact.id, tickets.target)))
    .leftJoin(senses, eq(senses.id, sql`coalesce(${fact.subjectId}, ${tickets.target})`))
    .leftJoin(entries, eq(entries.id, sql`coalesce(${senses.entryId}, ${fact.subjectId}, ${tickets.target})`))
}

const toTicketWithEntry = (row: { ticket: TicketRow; entryId: string | null; lemma: string | null }) => ({
  ...toTicket(row.ticket),
  entry: row.entryId && row.lemma ? { id: row.entryId as EntryId, lemma: row.lemma as Lemma } : null,
})

export function createTicketRepo(db: Db): TicketRepo {
  return {
    async open(ticket: TicketRecord) {
      await db.insert(tickets).values(fromTicket(ticket)).onConflictDoNothing()
      const row = await db
        .select()
        .from(tickets)
        .where(
          and(
            eq(tickets.type, ticket.type),
            eq(tickets.targetType, ticket.targetType),
            eq(tickets.target, ticket.target),
            eq(tickets.status, 'open'),
          ),
        )
        .get()
      if (!row) throw new Error(`Ticket ${ticket.id} was neither stored nor found open.`)
      return toTicket(row)
    },

    async find(id) {
      const row = await db.select().from(tickets).where(eq(tickets.id, id)).get()
      return row ? toTicket(row) : null
    },

    async findWithEntry(id) {
      const row = await withEntry(db).where(eq(tickets.id, id)).get()
      return row ? toTicketWithEntry(row) : null
    },

    async update(next, expectedRevision) {
      const rows = await db
        .update(tickets)
        .set(fromTicket(next))
        .where(and(eq(tickets.id, next.id), eq(tickets.revision, expectedRevision)))
        .returning({ id: tickets.id })
      return rows.length > 0
    },

    async list({ status, type }, { limit, cursor }) {
      const after = cursor ? decodeCursor(cursor, ticketCursor) : undefined
      const rows = await withEntry(db)
        .where(
          and(
            status ? eq(tickets.status, status) : undefined,
            type ? eq(tickets.type, type) : undefined,
            after
              ? or(
                  gt(tickets.createdAt, after.created_at),
                  and(eq(tickets.createdAt, after.created_at), gt(tickets.id, after.id)),
                )
              : undefined,
          ),
        )
        .orderBy(asc(tickets.createdAt), asc(tickets.id))
        .limit(limit + 1)
      return page(rows, limit, toTicketWithEntry, (row) => ({ created_at: row.ticket.createdAt, id: row.ticket.id }))
    },

    async countByStatus() {
      const rows = await db.select({ status: tickets.status, count: count() }).from(tickets).groupBy(tickets.status)
      const counts = { open: 0, resolved: 0, dismissed: 0 }
      for (const row of rows) counts[ticketStatusSchema.parse(row.status)] = row.count
      return counts
    },
  }
}
