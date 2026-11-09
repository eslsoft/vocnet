import { entries, facts, worklist } from '@server/db/schema'
import type { PrincipalRef } from '@server/domain/principal'
import type { WorkLease } from '@server/domain/work'
import type { WorkRepo } from '@server/usecases/ports'
import type { EntryId } from '@shared/facts'
import type { WorkLeaseId } from '@shared/work'
import { and, asc, eq, exists, gt, inArray, isNull, lte, or, type SQLWrapper, sql } from 'drizzle-orm'
import { type Db, liveStatus, toEntry } from './rows'

type LeasedRow = typeof worklist.$inferSelect & { leaseId: string; leaseHolder: string; leaseExpiresAt: string }

const toLease = (row: LeasedRow): WorkLease => ({
  id: row.leaseId as WorkLeaseId,
  entryId: row.entryId as EntryId,
  holder: row.leaseHolder as PrincipalRef,
  expiresAt: row.leaseExpiresAt,
})

/** Creates the entry's worklist row once the entry row exists; a repeat is a no-op. */
export function insertWorklistRow(db: Db, entryId: string) {
  return db
    .insert(worklist)
    .select(
      db
        .select({
          entryId: entries.id,
          createdAt: entries.createdAt,
          live: sql`0`.as('live'),
          claimedAt: sql`null`.as('claimed_at'),
          leaseId: sql`null`.as('lease_id'),
          leaseHolder: sql`null`.as('lease_holder'),
          leaseExpiresAt: sql`null`.as('lease_expires_at'),
          lastWorkedAt: sql`null`.as('last_worked_at'),
          lastWorkedBy: sql`null`.as('last_worked_by'),
          lastNote: sql`null`.as('last_note'),
        })
        .from(entries)
        .where(eq(entries.id, entryId)),
    )
    .onConflictDoNothing()
}

/**
 * Recomputes `live` from the entry fact. Batch it after every fact write about these subjects; a
 * subject that is not an entry matches no row.
 */
export function syncWorklistLive(db: Db, subjectIds: string[] | SQLWrapper) {
  const liveEntryFact = db
    .select({ one: sql`1` })
    .from(facts)
    .where(and(eq(facts.kind, 'entry'), eq(facts.subjectId, worklist.entryId), liveStatus))
  return db
    .update(worklist)
    .set({ live: exists(liveEntryFact) })
    .where(inArray(worklist.entryId, subjectIds))
}

/**
 * Leases the first free live entry in claim order and stamps the claim time, in one statement.
 * D1 runs statements one at a time, so two concurrent claims never take the same entry. Every
 * claim moves its entry to the back of the index, so held leases never sit in front of free rows.
 */
export function claimStatement(db: Db, lease: Omit<WorkLease, 'entryId'>, now: string) {
  const next = db
    .select({ entryId: worklist.entryId })
    .from(worklist)
    .where(and(eq(worklist.live, true), or(isNull(worklist.leaseExpiresAt), lte(worklist.leaseExpiresAt, now))))
    .orderBy(asc(worklist.claimedAt), asc(worklist.createdAt), asc(worklist.entryId))
    .limit(1)
  return db
    .update(worklist)
    .set({ claimedAt: now, leaseId: lease.id, leaseHolder: lease.holder, leaseExpiresAt: lease.expiresAt })
    .where(eq(worklist.entryId, sql`(${next})`))
    .returning()
}

export function createWorkRepo(db: Db): WorkRepo {
  const held = (lease: WorkLease, at: string) =>
    and(eq(worklist.leaseId, lease.id), eq(worklist.leaseHolder, lease.holder), gt(worklist.leaseExpiresAt, at))

  return {
    async claimNext(lease, now) {
      const [row] = await claimStatement(db, lease, now)
      if (!row) return null
      const entry = await db.select().from(entries).where(eq(entries.id, row.entryId)).get()
      if (!entry) throw new Error(`Leased entry ${row.entryId} does not exist.`)
      return { lease: toLease(row as LeasedRow), entry: toEntry(entry) }
    },

    async findLease(id) {
      const row = await db.select().from(worklist).where(eq(worklist.leaseId, id)).get()
      return row ? toLease(row as LeasedRow) : null
    },

    async complete(lease, at, note) {
      const done = await db
        .update(worklist)
        .set({
          lastWorkedAt: at,
          lastWorkedBy: lease.holder,
          lastNote: note,
          leaseId: null,
          leaseHolder: null,
          leaseExpiresAt: null,
        })
        .where(held(lease, at))
        .returning({ entryId: worklist.entryId })
      return done.length > 0
    },
  }
}
