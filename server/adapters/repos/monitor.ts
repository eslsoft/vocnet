import { entries, facts, senses, workAttempts, workItemLog, workItems, workLeases, worklist } from '@server/db/schema'
import type { PrincipalRef } from '@server/domain/principal'
import type { Lemma } from '@server/domain/term'
import type { MonitorRepo, WorkAttemptRecord, WorkItemRecord } from '@server/usecases/ports'
import { type EntryId, factKindSchema } from '@shared/facts'
import { workAttemptOutcomeSchema } from '@shared/monitor'
import { gapSchema, type WorkItemId, workTypeSchema } from '@shared/work'
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { type Db, decodeCursor, liveStatus, page, toFact, weakReview } from './rows'
import { toLease } from './work'

/**
 * The live gloss of the sense the outer row's subject names: the published one, else the pending
 * one under review; null when the subject is not a sense.
 */
function glossOf(db: Db, subjectId: SQLWrapper) {
  const gloss = alias(facts, 'gloss')
  return sql<string | null>`(${db
    .select({ text: sql`json_extract(${gloss.payload}, '$.gloss')` })
    .from(gloss)
    .where(
      and(eq(gloss.kind, 'sense'), eq(gloss.subjectId, subjectId), inArray(gloss.status, ['pending', 'published'])),
    )
    .orderBy(desc(sql`${gloss.status} = 'published'`), desc(gloss.updatedAt))
    .limit(1)})`
}

const leased = (now: string) => sql<number>`coalesce(${workItems.leaseExpiresAt} > ${now}, 0)`

/**
 * The median of `value` over the rows `source` selects (a table and its condition), per `group`:
 * the middle row, or the mean of the middle two.
 */
const medianStatement = (value: SQL, source: SQL, group: SQL) => sql`
  select grp, avg(value) as median from (
    select ${group} as grp, ${value} as value,
      row_number() over (partition by ${group} order by ${value}) as rn,
      count(*) over (partition by ${group}) as n
    from ${source}
  ) where rn in ((n + 1) / 2, (n + 2) / 2) group by grp`

const attemptCursor = z.object({ completed_at: z.string(), id: z.string() })

/** The outer attempt's 1-based place among its item's attempts by completion; reads work_attempts_item_idx. */
function ordinalOf(db: Db) {
  const earlier = alias(workAttempts, 'earlier')
  return sql<number>`(${db
    .select({ count: count() })
    .from(earlier)
    .where(
      and(
        eq(earlier.itemId, workAttempts.itemId),
        or(
          lt(earlier.completedAt, workAttempts.completedAt),
          and(eq(earlier.completedAt, workAttempts.completedAt), lte(earlier.id, workAttempts.id)),
        ),
      ),
    )})`
}

const attemptColumns = (db: Db) => ({
  attempt: workAttempts,
  ordinal: ordinalOf(db),
  lemma: entries.lemma,
  senseGloss: glossOf(db, workAttempts.subjectId),
})

type AttemptRow = {
  attempt: typeof workAttempts.$inferSelect
  ordinal: number
  lemma: string
  senseGloss: string | null
}

/**
 * The facts the holder authored during the attempt about its item's node: the node itself, the
 * senses of an entry, and the subject of a weak fact. Each term reads facts_subject_idx.
 */
function attemptFacts(db: Db, attempt: typeof workAttempts.$inferSelect) {
  const weak = alias(facts, 'weak')
  const node = attempt.subjectId
  return db
    .select()
    .from(facts)
    .where(
      and(
        or(
          eq(facts.subjectId, node),
          inArray(facts.subjectId, db.select({ id: senses.id }).from(senses).where(eq(senses.entryId, node))),
          inArray(facts.subjectId, db.select({ id: weak.subjectId }).from(weak).where(eq(weak.id, node))),
        ),
        eq(facts.author, attempt.holder),
        gte(facts.createdAt, attempt.claimedAt),
        lte(facts.createdAt, attempt.completedAt),
      ),
    )
    .orderBy(asc(facts.createdAt), asc(facts.id))
}

async function withFacts(db: Db, rows: AttemptRow[]): Promise<WorkAttemptRecord[]> {
  if (rows.length === 0) return []
  const [first, ...rest] = rows.map((row) => attemptFacts(db, row.attempt))
  const found = await db.batch([first!, ...rest])
  return rows.map(({ attempt, ordinal, lemma, senseGloss }, at) => ({
    id: attempt.id,
    itemId: attempt.itemId as WorkItemId,
    ordinal,
    entryId: attempt.entryId as EntryId,
    lemma: lemma as Lemma,
    type: workTypeSchema.parse(attempt.type),
    subjectId: attempt.subjectId,
    senseGloss,
    holder: attempt.holder as PrincipalRef,
    claimedAt: attempt.claimedAt,
    completedAt: attempt.completedAt,
    seconds: attempt.seconds,
    note: attempt.note,
    outcome: workAttemptOutcomeSchema.parse(attempt.outcome),
    facts: found[at]!.map(toFact),
  }))
}

const toOpenItem = (row: {
  item: typeof workItems.$inferSelect
  lemma: string
  senseGloss: string | null
}): WorkItemRecord => ({
  id: row.item.id as WorkItemId,
  entryId: row.item.entryId as EntryId,
  lemma: row.lemma as Lemma,
  type: workTypeSchema.parse(row.item.type),
  subjectId: row.item.subjectId,
  senseGloss: row.senseGloss,
  gap: gapSchema.parse(JSON.parse(row.item.gap)),
  awaiting: row.item.awaiting,
  attempts: row.item.attempts,
  lease:
    row.item.leaseHolder === null || row.item.leaseExpiresAt === null
      ? null
      : { holder: row.item.leaseHolder as PrincipalRef, expiresAt: row.item.leaseExpiresAt },
  createdAt: row.item.createdAt,
  closedAt: null,
})

const queueOrder = [asc(workItems.rank), desc(workItems.zipfOrder), asc(workItems.createdAt), asc(workItems.id)]

export function createMonitorRepo(db: Db): MonitorRepo {
  const openItems = () =>
    db
      .select({ item: workItems, lemma: entries.lemma, senseGloss: glossOf(db, workItems.subjectId) })
      .from(workItems)
      .innerJoin(entries, eq(entries.id, workItems.entryId))

  return {
    async countWeakByKind() {
      const rows = await db
        .select({ kind: facts.kind, count: count() })
        .from(facts)
        .where(weakReview)
        .groupBy(facts.kind)
        .orderBy(asc(facts.kind))
      return rows.map((row) => ({ kind: factKindSchema.parse(row.kind), count: row.count }))
    },

    async countLiveFacts() {
      const [row] = await db.select({ count: count() }).from(facts).where(liveStatus)
      return row?.count ?? 0
    },

    async completenessByLevel() {
      return db
        .select({
          levelRank: worklist.levelRank,
          entries: count(),
          complete: sql<number>`sum(${worklist.completeness} >= 1)`,
          sum: sql<number>`total(${worklist.completeness})`,
        })
        .from(worklist)
        .where(eq(worklist.live, true))
        .groupBy(worklist.levelRank)
    },

    async pendingReview(before) {
      const [row] = await db
        .select({
          count: count(),
          oldestAt: sql<string | null>`min(${facts.createdAt})`,
          olderThan: sql<number>`coalesce(sum(${facts.createdAt} < ${before}), 0)`,
        })
        .from(facts)
        .where(eq(facts.status, 'pending'))
      return row ?? { count: 0, oldestAt: null, olderThan: 0 }
    },

    async countOpenItems(now) {
      const rows = await db
        .select({
          type: workItems.type,
          levelRank: worklist.levelRank,
          attempts: workItems.attempts,
          awaiting: workItems.awaiting,
          leased: leased(now),
          count: count(),
        })
        .from(workItems)
        .leftJoin(worklist, eq(worklist.entryId, workItems.entryId))
        .groupBy(workItems.type, worklist.levelRank, workItems.attempts, workItems.awaiting, leased(now))
      return rows.map((row) => ({ ...row, type: workTypeSchema.parse(row.type), leased: row.leased === 1 }))
    },

    async countTimedOutLeases(since, now) {
      const [row] = await db
        .select({ count: count() })
        .from(workLeases)
        .where(and(gt(workLeases.expiresAt, since), lte(workLeases.expiresAt, now)))
      return row?.count ?? 0
    },

    async itemFlow(since) {
      const rows = await db
        .select({
          type: workItemLog.type,
          levelRank: worklist.levelRank,
          created: sql<number>`sum(${workItemLog.createdAt} >= ${since})`,
          closed: sql<number>`coalesce(sum(${workItemLog.closedAt} >= ${since}), 0)`,
        })
        .from(workItemLog)
        .leftJoin(worklist, eq(worklist.entryId, workItemLog.entryId))
        .where(or(gte(workItemLog.createdAt, since), gte(workItemLog.closedAt, since)))
        .groupBy(workItemLog.type, worklist.levelRank)
      return rows.map((row) => ({ ...row, type: workTypeSchema.parse(row.type) }))
    },

    async throughput(since, keyLength) {
      const bucket = (column: SQLWrapper) => sql<string>`substr(${column}, 1, ${keyLength})`
      const [created, closed] = await db.batch([
        db
          .select({ key: bucket(workItemLog.createdAt), count: count() })
          .from(workItemLog)
          .where(gte(workItemLog.createdAt, since))
          .groupBy(bucket(workItemLog.createdAt)),
        db
          .select({ key: bucket(workItemLog.closedAt), count: count() })
          .from(workItemLog)
          .where(gte(workItemLog.closedAt, since))
          .groupBy(bucket(workItemLog.closedAt)),
      ])
      const keys = [...new Set([...created, ...closed].map((row) => row.key))]
      return keys.map((key) => ({
        key,
        created: created.find((row) => row.key === key)?.count ?? 0,
        closed: closed.find((row) => row.key === key)?.count ?? 0,
      }))
    },

    async medianCloseSeconds(since) {
      const [row] = await db.all<{ median: number }>(
        medianStatement(
          sql`(julianday(closed_at) - julianday(created_at)) * 86400`,
          sql`work_item_log where closed_at >= ${since}`,
          sql`1`,
        ),
      )
      return row?.median ?? null
    },

    async attemptStats(since) {
      const [medians, outcomes] = await Promise.all([
        db.all<{ grp: string; median: number }>(
          medianStatement(sql`seconds`, sql`work_attempts where completed_at >= ${since}`, sql`type`),
        ),
        db
          .select({
            type: workAttempts.type,
            settled: sql<number>`sum(${workAttempts.outcome} <> 'waiting_on_review')`,
            succeeded: sql<number>`sum(${workAttempts.outcome} in ('closed', 'progressed'))`,
          })
          .from(workAttempts)
          .where(gte(workAttempts.completedAt, since))
          .groupBy(workAttempts.type),
      ])
      return outcomes.map((row) => ({
        type: workTypeSchema.parse(row.type),
        medianSeconds: medians.find((median) => median.grp === row.type)!.median,
        settled: row.settled,
        succeeded: row.succeeded,
      }))
    },

    async listLeases(since, limit) {
      const rows = await db
        .select()
        .from(workLeases)
        .where(gt(workLeases.expiresAt, since))
        .orderBy(desc(workLeases.claimedAt), desc(workLeases.id))
        .limit(limit)
      const leases = rows.map(toLease)
      const firstEntries = [...new Set(leases.flatMap((lease) => lease.entryIds.slice(0, 3)))]
      const lemmas =
        firstEntries.length === 0
          ? []
          : await db
              .select({ id: entries.id, lemma: entries.lemma })
              .from(entries)
              .where(inArray(entries.id, firstEntries))
      const lemmaOf = new Map(lemmas.map((row) => [row.id, row.lemma as Lemma]))
      return leases.map((lease) => ({ ...lease, lemmas: lease.entryIds.slice(0, 3).map((id) => lemmaOf.get(id)!) }))
    },

    async countHolders(now) {
      const [row] = await db
        .select({ count: countDistinct(workLeases.holder) })
        .from(workLeases)
        .where(gt(workLeases.expiresAt, now))
      return row?.count ?? 0
    },

    async listAttempts({ outcome, type, holder, lemma }, request) {
      const after = request.cursor ? decodeCursor(request.cursor, attemptCursor) : undefined
      const rows = await db
        .select(attemptColumns(db))
        .from(workAttempts)
        .innerJoin(entries, eq(entries.id, workAttempts.entryId))
        .where(
          and(
            outcome ? eq(workAttempts.outcome, outcome) : undefined,
            type ? eq(workAttempts.type, type) : undefined,
            holder ? eq(workAttempts.holder, holder) : undefined,
            lemma ? eq(entries.lemma, lemma) : undefined,
            after
              ? or(
                  lt(workAttempts.completedAt, after.completed_at),
                  and(eq(workAttempts.completedAt, after.completed_at), lt(workAttempts.id, after.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(workAttempts.completedAt), desc(workAttempts.id))
        .limit(request.limit + 1)
      const found = page(
        rows,
        request.limit,
        (row) => row,
        (row) => ({ completed_at: row.attempt.completedAt, id: row.attempt.id }),
      )
      return { items: await withFacts(db, found.items), nextCursor: found.nextCursor }
    },

    async listItemAttempts(itemId) {
      const rows = await db
        .select(attemptColumns(db))
        .from(workAttempts)
        .innerJoin(entries, eq(entries.id, workAttempts.entryId))
        .where(eq(workAttempts.itemId, itemId))
        .orderBy(desc(workAttempts.completedAt), desc(workAttempts.id))
      return withFacts(db, rows)
    },

    async listOpenItems(by) {
      const rows = await openItems()
        .where('entryId' in by ? eq(workItems.entryId, by.entryId) : eq(workItems.subjectId, by.subjectId))
        .orderBy(...queueOrder)
      return rows.map(toOpenItem)
    },

    async findItem(id) {
      const [open] = await openItems().where(eq(workItems.id, id))
      if (open) return toOpenItem(open)
      const [closed] = await db
        .select({ item: workItemLog, lemma: entries.lemma, senseGloss: glossOf(db, workItemLog.subjectId) })
        .from(workItemLog)
        .innerJoin(entries, eq(entries.id, workItemLog.entryId))
        .where(and(eq(workItemLog.id, id), isNotNull(workItemLog.closedAt)))
      if (!closed) return null
      return {
        id: closed.item.id as WorkItemId,
        entryId: closed.item.entryId as EntryId,
        lemma: closed.lemma as Lemma,
        type: workTypeSchema.parse(closed.item.type),
        subjectId: closed.item.subjectId,
        senseGloss: closed.senseGloss,
        gap: gapSchema.parse(JSON.parse(closed.item.gap)),
        awaiting: false,
        attempts: 0,
        lease: null,
        createdAt: closed.item.createdAt,
        closedAt: closed.item.closedAt,
      }
    },
  }
}
