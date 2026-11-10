import { entries, facts, senses, wordFrequency, worklist } from '@server/db/schema'
import type { PrincipalRef } from '@server/domain/principal'
import { frequencyKey } from '@server/domain/reference'
import type { WorkLease } from '@server/domain/work'
import type { StaleWork, WorkRepo } from '@server/usecases/ports'
import type { EntryId } from '@shared/facts'
import type { WorkLeaseId } from '@shared/work'
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  type SQLWrapper,
  sql,
} from 'drizzle-orm'
import { levelRankSql } from '../reference-sql'
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
  expiresAt: row.leaseExpiresAt,
})

/**
 * Creates the entry's worklist row once the entry row exists, with the learner priority of its
 * lemma as the reference tables give it now; a repeat is a no-op. The select goes in as SQL
 * because drizzle's builder check demands the generated `claim_rank` among the fields.
 */
export function insertWorklistRow(db: Db, entry: { id: string; lemma: string }) {
  const key = frequencyKey(entry.lemma)
  return db
    .insert(worklist)
    .select(
      db
        .select({
          entryId: entries.id,
          createdAt: entries.createdAt,
          live: sql`0`.as('live'),
          claimedAt: sql`null`.as('claimed_at'),
          seed: sql`0`.as('seed'),
          frequencyKey: sql`${key}`.as('frequency_key'),
          levelRank: sql.raw(levelRankSql('entries.lemma')).as('level_rank'),
          zipf: sql`(${db.select({ zipf: wordFrequency.zipf }).from(wordFrequency).where(eq(wordFrequency.word, key))})`.as(
            'zipf',
          ),
          completeness: sql`0`.as('completeness'),
          quality: sql`1`.as('quality'),
          stalled: sql`0`.as('stalled'),
          awaitingReview: sql`0`.as('awaiting_review'),
          claimedWork: sql`null`.as('claimed_work'),
          revision: sql`0`.as('revision'),
          scoredRevision: sql`0`.as('scored_revision'),
          leaseId: sql`null`.as('lease_id'),
          leaseHolder: sql`null`.as('lease_holder'),
          leaseExpiresAt: sql`null`.as('lease_expires_at'),
          lastWorkedAt: sql`null`.as('last_worked_at'),
          lastWorkedBy: sql`null`.as('last_worked_by'),
          lastNote: sql`null`.as('last_note'),
        })
        .from(entries)
        .where(eq(entries.id, entry.id))
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

const bumpRevision = { revision: sql`${worklist.revision} + 1` }

/**
 * Marks stale the worklist rows of the entries that are, or own as a sense, these nodes. Batch it
 * with every write that can change an entry's gaps or weak facts, so a rescore the write's use case
 * never got to still leaves the row claimable and listed as stale.
 */
export function touchWorkOf(db: Db, nodeIds: string[] | SQLWrapper) {
  const owners = db.select({ id: senses.entryId }).from(senses).where(inArray(senses.id, nodeIds))
  return db
    .update(worklist)
    .set(bumpRevision)
    .where(or(inArray(worklist.entryId, nodeIds), inArray(worklist.entryId, owners)))
}

/** Marks stale the entries at either end of this fact, entry or sense; a fact that does not exist marks nothing. */
export function touchWorkOfFact(db: Db, factId: string) {
  const subject = db.select({ id: facts.subjectId }).from(facts).where(eq(facts.id, factId))
  const object = db
    .select({ id: facts.objectId })
    .from(facts)
    .where(and(eq(facts.id, factId), isNotNull(facts.objectId)))
  const senseOwners = db
    .select({ id: senses.entryId })
    .from(senses)
    .where(or(inArray(senses.id, subject), inArray(senses.id, object)))
  return db
    .update(worklist)
    .set(bumpRevision)
    .where(or(inArray(worklist.entryId, subject), inArray(worklist.entryId, senseOwners)))
}

/**
 * The entries with a sense that a relation links to a sense that is, or belongs to, one of these
 * nodes. A relation fills a gap only while the sense at its other end has a live gloss and a live
 * entry fact, so those facts entering or leaving live change the linked entries' gaps.
 */
function linkedEntriesOf(db: Db, nodeIds: string[] | SQLWrapper) {
  const nodeSenses = db
    .select({ id: senses.id })
    .from(senses)
    .where(or(inArray(senses.id, nodeIds), inArray(senses.entryId, nodeIds)))
  const sources = db
    .select({ id: facts.subjectId })
    .from(facts)
    .where(and(eq(facts.kind, 'relation'), inArray(facts.objectId, nodeSenses)))
  const targets = db
    .select({ id: facts.objectId })
    .from(facts)
    .where(and(eq(facts.kind, 'relation'), inArray(facts.subjectId, nodeSenses)))
  return db
    .select({ id: senses.entryId })
    .from(senses)
    .where(or(inArray(senses.id, sources), inArray(senses.id, targets)))
}

/**
 * Marks stale the entries linked by a relation to the entry or sense this fact defines; a fact of
 * any other kind, or one that does not exist, marks nothing. Batch it with every write that moves
 * an `entry` or `sense` fact into or out of live.
 */
export function touchLinkedWorkOfFact(db: Db, factId: string) {
  const defined = db
    .select({ id: facts.subjectId })
    .from(facts)
    .where(and(eq(facts.id, factId), inArray(facts.kind, ['entry', 'sense'])))
  return db
    .update(worklist)
    .set(bumpRevision)
    .where(inArray(worklist.entryId, linkedEntriesOf(db, defined)))
}

/**
 * Leases the first free claimable entry in claim order and stamps the claim time, in one
 * statement. D1 runs statements one at a time, so two concurrent claims never take the same entry.
 * The scan passes at most one row per held lease before a free row.
 */
export function claimStatement(db: Db, lease: Omit<WorkLease, 'entryId' | 'claimedAt'>, now: string) {
  const next = db
    .select({ entryId: worklist.entryId })
    .from(worklist)
    .where(and(isNotNull(worklist.claimRank), or(isNull(worklist.leaseExpiresAt), lte(worklist.leaseExpiresAt, now))))
    .orderBy(
      asc(worklist.claimRank),
      asc(worklist.claimedAt),
      desc(worklist.zipf),
      asc(worklist.completeness),
      asc(worklist.createdAt),
      asc(worklist.entryId),
    )
    .limit(1)
  return db
    .update(worklist)
    .set({ claimedAt: now, leaseId: lease.id, leaseHolder: lease.holder, leaseExpiresAt: lease.expiresAt })
    .where(eq(worklist.entryId, sql`(${next})`))
    .returning()
}

const staleColumns = {
  entryId: worklist.entryId,
  revision: worklist.revision,
  claimedWork: worklist.claimedWork,
  completed: sql<number>`${worklist.lastWorkedAt} is not null and ${worklist.claimedAt} is not null and ${worklist.lastWorkedAt} >= ${worklist.claimedAt}`,
}
const isStale = ne(worklist.revision, worklist.scoredRevision)
const toStale = (row: {
  entryId: string
  revision: number
  claimedWork: string | null
  completed: number
}): StaleWork => ({
  entryId: row.entryId as EntryId,
  revision: row.revision,
  lastClaim: { openWork: row.claimedWork, completed: row.completed === 1 },
})

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

    async recordClaimedWork(lease, openWork) {
      const rows = await db
        .update(worklist)
        .set({ claimedWork: openWork })
        .where(eq(worklist.leaseId, lease.id))
        .returning({ entryId: worklist.entryId })
      if (rows.length === 0) throw new Error(`Lease ${lease.id} vanished right after its claim.`)
    },

    async complete(lease, at, note) {
      const done = await db
        .update(worklist)
        .set({
          lastWorkedAt: at,
          lastWorkedBy: lease.holder,
          lastNote: note,
          ...bumpRevision,
          leaseId: null,
          leaseHolder: null,
          leaseExpiresAt: null,
        })
        .where(held(lease, at))
        .returning({ entryId: worklist.entryId })
      return done.length > 0
    },

    async listStale(nodeIds) {
      const owners = db.select({ id: senses.entryId }).from(senses).where(inArray(senses.id, nodeIds))
      const rows = await db
        .select(staleColumns)
        .from(worklist)
        .where(
          and(
            isStale,
            or(
              inArray(worklist.entryId, nodeIds),
              inArray(worklist.entryId, owners),
              inArray(worklist.entryId, linkedEntriesOf(db, nodeIds)),
            ),
          ),
        )
      return rows.map(toStale)
    },

    async listAnyStale(limit) {
      const rows = await db
        .select(staleColumns)
        .from(worklist)
        .where(isStale)
        .orderBy(asc(worklist.entryId))
        .limit(limit)
      return rows.map(toStale)
    },

    async saveScores(stale, scores) {
      await db
        .update(worklist)
        .set({ ...scores, scoredRevision: stale.revision })
        .where(and(eq(worklist.entryId, stale.entryId), eq(worklist.revision, stale.revision)))
    },
  }
}
