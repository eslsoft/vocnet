import { entries, entryWork, facts, workLeases } from '@server/db/schema'
import type { PrincipalRef } from '@server/domain/principal'
import type { WorkLease } from '@server/domain/work'
import type { WorkRepo } from '@server/usecases/ports'
import type { EntryId } from '@shared/facts'
import type { WorkLeaseId } from '@shared/work'
import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm'
import { type Db, liveStatus, toEntry } from './rows'

const toLease = (row: typeof workLeases.$inferSelect): WorkLease => ({
  id: row.id as WorkLeaseId,
  entryId: row.entryId as EntryId,
  holder: row.holder as PrincipalRef,
  expiresAt: row.expiresAt,
})

export function createWorkRepo(db: Db): WorkRepo {
  const held = (lease: WorkLease, at: string) =>
    and(eq(workLeases.id, lease.id), eq(workLeases.holder, lease.holder), gt(workLeases.expiresAt, at))

  return {
    async claimNext(lease, now) {
      // One statement picks and leases the entry, and D1 runs statements one at a time, so two
      // concurrent claims cannot pick the same entry. The update only replaces an expired lease.
      const next = db
        .select({
          id: sql`${lease.id}`.as('id'),
          entryId: entries.id,
          holder: sql`${lease.holder}`.as('holder'),
          expiresAt: sql`${lease.expiresAt}`.as('expires_at'),
        })
        .from(entries)
        .innerJoin(facts, and(eq(facts.kind, 'entry'), eq(facts.subjectId, entries.id), liveStatus))
        .leftJoin(workLeases, eq(workLeases.entryId, entries.id))
        .leftJoin(entryWork, eq(entryWork.entryId, entries.id))
        .where(or(isNull(workLeases.id), lte(workLeases.expiresAt, now)))
        .orderBy(sql`${entryWork.lastWorkedAt} asc nulls first`, asc(entries.createdAt), asc(entries.id))
        .limit(1)
      const [row] = await db
        .insert(workLeases)
        .select(next)
        .onConflictDoUpdate({
          target: workLeases.entryId,
          set: { id: sql`excluded.id`, holder: sql`excluded.holder`, expiresAt: sql`excluded.expires_at` },
          setWhere: lte(workLeases.expiresAt, now),
        })
        .returning()
      if (!row) return null
      const entry = await db.select().from(entries).where(eq(entries.id, row.entryId)).get()
      if (!entry) throw new Error(`Leased entry ${row.entryId} does not exist.`)
      return { lease: toLease(row), entry: toEntry(entry) }
    },

    async findLease(id) {
      const row = await db.select().from(workLeases).where(eq(workLeases.id, id)).get()
      return row ? toLease(row) : null
    },

    async complete(lease, at, note) {
      // One batch is one transaction: the record is written only from the lease the delete removes.
      const record = db
        .select({
          entryId: workLeases.entryId,
          lastWorkedAt: sql`${at}`.as('last_worked_at'),
          lastWorkedBy: workLeases.holder,
          lastNote: sql`${note}`.as('last_note'),
        })
        .from(workLeases)
        .where(held(lease, at))
      const [, removed] = await db.batch([
        db
          .insert(entryWork)
          .select(record)
          .onConflictDoUpdate({
            target: entryWork.entryId,
            set: {
              lastWorkedAt: sql`excluded.last_worked_at`,
              lastWorkedBy: sql`excluded.last_worked_by`,
              lastNote: sql`excluded.last_note`,
            },
          }),
        db.delete(workLeases).where(held(lease, at)).returning({ id: workLeases.id }),
      ])
      return removed.length > 0
    },
  }
}
