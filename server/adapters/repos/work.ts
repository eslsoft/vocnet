import { entries, facts, senses, worklist } from '@server/db/schema'
import type { PrincipalRef } from '@server/domain/principal'
import { MAX_REVISIT_STREAK, type WorkLease } from '@server/domain/work'
import type { WorkRepo } from '@server/usecases/ports'
import type { EntryId } from '@shared/facts'
import type { WorkLeaseId } from '@shared/work'
import { and, asc, eq, exists, gt, inArray, isNull, lt, lte, ne, or, type SQLWrapper, sql } from 'drizzle-orm'
import { type Db, liveStatus, toEntry } from './rows'

type LeasedRow = typeof worklist.$inferSelect & {
  claimedAt: string
  leaseId: string
  leaseHolder: string
  leaseExpiresAt: string
}

const toLease = (row: LeasedRow): WorkLease => ({
  id: row.leaseId as WorkLeaseId,
  entryId: row.entryId as EntryId,
  holder: row.leaseHolder as PrincipalRef,
  claimedAt: row.claimedAt,
  revisitStreak: row.revisitStreak,
  expiresAt: row.leaseExpiresAt,
})

/**
 * Creates the entry's worklist row once the entry row exists; a repeat is a no-op. The select goes
 * in as SQL because drizzle's builder check demands the generated `claim_rank` among the fields.
 */
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
          claimCount: sql`0`.as('claim_count'),
          seed: sql`0`.as('seed'),
          revisit: sql`0`.as('revisit'),
          revisitStreak: sql`0`.as('revisit_streak'),
          leaseId: sql`null`.as('lease_id'),
          leaseHolder: sql`null`.as('lease_holder'),
          leaseExpiresAt: sql`null`.as('lease_expires_at'),
          lastWorkedAt: sql`null`.as('last_worked_at'),
          lastWorkedBy: sql`null`.as('last_worked_by'),
          lastNote: sql`null`.as('last_note'),
        })
        .from(entries)
        .where(eq(entries.id, entryId))
        .getSQL(),
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

// Every mark is gated by the streak, so a mark is never what keeps an entry ahead of the rotation
// past its last allowed revisit; it waits for the rotation claim instead.
const streakAllows = lt(worklist.revisitStreak, MAX_REVISIT_STREAK)

/**
 * Marks for a revisit the entries that own this fact's subject or object, entry or sense, if the
 * fact is now `to` as of `at`. Batch it after the write that takes the fact out of live, since that
 * can reopen a gap; a repeated delivery whose conditional write matched nothing marks nothing.
 */
export function revisitEntriesOfFact(db: Db, fact: { id: string; to: string; at: string }) {
  const written = and(eq(facts.id, fact.id), eq(facts.status, fact.to), eq(facts.updatedAt, fact.at))
  const subject = db.select({ id: facts.subjectId }).from(facts).where(written)
  const object = db.select({ id: facts.objectId }).from(facts).where(written)
  const senseOwners = db
    .select({ id: senses.entryId })
    .from(senses)
    .where(or(inArray(senses.id, subject), inArray(senses.id, object)))
  return db
    .update(worklist)
    .set({ revisit: true })
    .where(and(or(inArray(worklist.entryId, subject), inArray(worklist.entryId, senseOwners)), streakAllows))
}

/**
 * Marks the sense's entry for a revisit. Batch it after inserting the sense, whose gloss opens
 * per-sense gaps; a sense the insert did not create matches no row. A sense the entry's lease holder
 * adds is part of its pass, which the completion judges.
 */
export function revisitEntryOfSense(db: Db, sense: { id: string; createdBy: string }) {
  const owner = db.select({ id: senses.entryId }).from(senses).where(eq(senses.id, sense.id))
  return db
    .update(worklist)
    .set({ revisit: true })
    .where(
      and(
        inArray(worklist.entryId, owner),
        or(isNull(worklist.leaseHolder), ne(worklist.leaseHolder, sense.createdBy)),
        streakAllows,
      ),
    )
}

/**
 * Leases the first free live entry in claim order, stamps the claim time and count, clears the
 * revisit mark, and counts the revisit streak (reset by a claim that was not a revisit), in one
 * statement. D1 runs statements one at a time, so two concurrent claims never
 * take the same entry.
 * Every claim moves its entry to the back of its rank, so the scan passes at most one row per held
 * lease before a free row.
 */
export function claimStatement(db: Db, lease: Omit<WorkLease, 'entryId' | 'claimedAt' | 'revisitStreak'>, now: string) {
  const next = db
    .select({ entryId: worklist.entryId })
    .from(worklist)
    .where(and(eq(worklist.live, true), or(isNull(worklist.leaseExpiresAt), lte(worklist.leaseExpiresAt, now))))
    .orderBy(asc(worklist.claimRank), asc(worklist.claimedAt), asc(worklist.createdAt), asc(worklist.entryId))
    .limit(1)
  return db
    .update(worklist)
    .set({
      claimedAt: now,
      claimCount: sql`${worklist.claimCount} + 1`,
      revisit: false,
      revisitStreak: sql`case when ${worklist.revisit} and ${worklist.claimCount} > 1 then ${worklist.revisitStreak} + 1 else 0 end`,
      leaseId: lease.id,
      leaseHolder: lease.holder,
      leaseExpiresAt: lease.expiresAt,
    })
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

    async markSeed(entryId) {
      await db.update(worklist).set({ seed: true }).where(eq(worklist.entryId, entryId))
    },

    async findLease(id) {
      const row = await db.select().from(worklist).where(eq(worklist.leaseId, id)).get()
      return row ? toLease(row as LeasedRow) : null
    },

    async complete(lease, at, { note, revisit }) {
      const done = await db
        .update(worklist)
        .set({
          lastWorkedAt: at,
          lastWorkedBy: lease.holder,
          lastNote: note,
          // Keep a mark set during the lease, such as a neighbor's rejected relation.
          revisit: sql`${worklist.revisit} or ${revisit ? 1 : 0}`,
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
