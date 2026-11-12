import {
  entries,
  facts,
  senses,
  tickets,
  wordFrequency,
  workAttempts,
  workItemLog,
  workItems,
  workLeases,
  worklist,
  workPassBlocks,
  workPasses,
} from '@server/db/schema'
import type { PrincipalRef } from '@server/domain/principal'
import { frequencyKey } from '@server/domain/reference'
import type { WorkItem, WorkLease } from '@server/domain/work'
import type { StaleWork, WorkRepo } from '@server/usecases/ports'
import { type EntryId, entryIdSchema } from '@shared/facts'
import {
  gapSchema,
  MAX_PASSES,
  type WorkItemId,
  type WorkLeaseId,
  workItemIdSchema,
  workTypeSchema,
} from '@shared/work'
import {
  and,
  asc,
  count,
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
  type SQL,
  type SQLWrapper,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'
import { levelRankSql } from '../reference-sql'
import { type Db, inIds } from './rows'

/**
 * Creates the entry's worklist row once the entry row exists, with the learner priority of its
 * lemma as the reference tables give it now; a repeat is a no-op.
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
          batch: sql`null`.as('batch'),
          frequencyKey: sql`${key}`.as('frequency_key'),
          levelRank: sql.raw(levelRankSql('entries.lemma')).as('level_rank'),
          zipf: sql`(${db.select({ zipf: wordFrequency.zipf }).from(wordFrequency).where(eq(wordFrequency.word, key))})`.as(
            'zipf',
          ),
          completeness: sql`0`.as('completeness'),
          credibility: sql`1`.as('credibility'),
          slotsTotal: sql`0`.as('slots_total'),
          slotsPublished: sql`0`.as('slots_published'),
          slotsPending: sql`0`.as('slots_pending'),
          revision: sql`0`.as('revision'),
          scoredRevision: sql`0`.as('scored_revision'),
          viewRevision: sql`0`.as('view_revision'),
          lastWorkedAt: sql`null`.as('last_worked_at'),
        })
        .from(entries)
        .where(eq(entries.id, entry.id))
        .getSQL(),
    )
    .onConflictDoNothing()
}

const bumpRevision = { revision: sql`${worklist.revision} + 1` }

/**
 * Marks stale the worklist rows of the entries that are, or own as a sense, these nodes. Batch it
 * with every write that can change an entry's gaps or weak facts, so a rescore the write's use case
 * never got to still leaves the row claimable and listed as stale.
 */
export function touchWorkOf(db: Db, nodeIds: string[] | SQLWrapper) {
  return db
    .update(worklist)
    .set(bumpRevision)
    .where(or(inArray(worklist.entryId, nodeIds), inArray(worklist.entryId, ownersOf(db, nodeIds))))
}

/**
 * The entries that own these nodes: a sense's entry, and for an example or collocation fact (what a
 * translation is about) the entry of its sense.
 */
function ownersOf(db: Db, nodeIds: string[] | SQLWrapper) {
  const factSenses = db.select({ id: facts.subjectId }).from(facts).where(inArray(facts.id, nodeIds))
  return db
    .select({ id: senses.entryId })
    .from(senses)
    .where(or(inArray(senses.id, nodeIds), inArray(senses.id, factSenses)))
}

/** Marks stale the entries at either end of this fact, entry or sense; a fact that does not exist marks nothing. */
export function touchWorkOfFact(db: Db, factId: string) {
  const subject = db.select({ id: facts.subjectId }).from(facts).where(eq(facts.id, factId))
  const object = db
    .select({ id: facts.objectId })
    .from(facts)
    .where(and(eq(facts.id, factId), isNotNull(facts.objectId)))
  return db
    .update(worklist)
    .set(bumpRevision)
    .where(
      or(
        inArray(worklist.entryId, subject),
        inArray(worklist.entryId, ownersOf(db, subject)),
        inArray(worklist.entryId, ownersOf(db, object)),
      ),
    )
}

/**
 * The entries with a sense that a relation links to a sense that is, or belongs to, one of these
 * nodes. A relation fills a gap only while a live entry's published inventory lists the sense at
 * its other end, so that inventory changing changes the linked entries' gaps.
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

/** The entries a base part names in the morphology facts `named` that `which` picks. */
function namedBases(db: Db, which: SQL) {
  return db
    .select({ id: entries.id })
    .from(entries)
    .where(
      sql`${entries.lemma} in (select json_extract(part.value, '$.lemma') from facts as named, json_each(named.payload, '$.parts') as part where named.kind = 'morphology' and json_extract(part.value, '$.role') = 'base' and ${which})`,
    )
}

/** The entries a base part names in this fact, when it is a morphology fact: their family gap changes with it. */
const familyBasesOf = (db: Db, factId: string) => namedBases(db, sql`named.id = ${factId}`)

/**
 * Marks stale the entries linked to the entry whose inventory this fact is, by a relation, and the
 * bases a morphology fact names. A fact of any other kind, or one that does not exist, marks
 * nothing. Batch it with every fact insert and status change.
 */
export function touchLinkedWorkOfFact(db: Db, factId: string) {
  const defined = db
    .select({ id: facts.subjectId })
    .from(facts)
    .where(and(eq(facts.id, factId), eq(facts.kind, 'senses')))
  return db
    .update(worklist)
    .set(bumpRevision)
    .where(
      or(inArray(worklist.entryId, linkedEntriesOf(db, defined)), inArray(worklist.entryId, familyBasesOf(db, factId))),
    )
}

/**
 * The worklist rows of the entries that are, or own as a sense, these nodes, of the entries whose
 * relations link to a sense that is or belongs to one of them, of the head of a phrase among them,
 * and of the bases their word formations name: every row a write about the nodes can make stale.
 */
export function relatedWorklistRows(db: Db, nodeIds: string[]) {
  return or(
    inArray(worklist.entryId, nodeIds),
    inArray(worklist.entryId, ownersOf(db, nodeIds)),
    inArray(worklist.entryId, linkedEntriesOf(db, nodeIds)),
    inArray(worklist.entryId, namedBases(db, inArray(sql`named.subject_id`, nodeIds))),
  )
}

/**
 * In the production queue: not awaiting a review and short of the attempt bound. A literal, not
 * bound, so SQLite matches it against the partial queue indexes.
 */
const inQueue = sql.raw(`work_items.awaiting = 0 and work_items.attempts < ${MAX_PASSES}`)
const free = (now: string) => or(isNull(workItems.leaseExpiresAt), lte(workItems.leaseExpiresAt, now))
const queueOrder = [asc(workItems.rank), desc(workItems.zipfOrder), asc(workItems.createdAt), asc(workItems.id)]

export function toWorkItem(row: typeof workItems.$inferSelect): WorkItem {
  return {
    id: row.id as WorkItemId,
    entryId: row.entryId as EntryId,
    type: workTypeSchema.parse(row.type),
    subjectId: row.subjectId,
    gap: gapSchema.parse(JSON.parse(row.gap)),
    stage: row.stage,
    rank: row.rank,
    zipfOrder: row.zipfOrder,
    awaiting: row.awaiting,
    attempts: row.attempts,
    worked: row.worked,
    foundNone: row.foundNone,
    claimedGap: row.claimedGap === null ? null : gapSchema.parse(JSON.parse(row.claimedGap)),
    lease:
      row.leaseId === null || row.leaseHolder === null || row.leaseExpiresAt === null
        ? null
        : { id: row.leaseId as WorkLeaseId, holder: row.leaseHolder as PrincipalRef, expiresAt: row.leaseExpiresAt },
    lastWorkedAt: row.lastWorkedAt,
    lastWorkedBy: row.lastWorkedBy as PrincipalRef | null,
    lastNote: row.lastNote,
  }
}

export const toLease = (row: typeof workLeases.$inferSelect): WorkLease => ({
  id: row.id as WorkLeaseId,
  holder: row.holder as PrincipalRef,
  type: workTypeSchema.parse(row.type),
  entryIds: z.array(entryIdSchema).parse(JSON.parse(row.entryIds)),
  itemIds: z.array(workItemIdSchema).parse(JSON.parse(row.itemIds)),
  claimedAt: row.claimedAt,
  expiresAt: row.expiresAt,
})

/**
 * The type of the first free item of the production queue, among `types` when given: the claim
 * leases items of this one type. Exported so a test can pin its query plan.
 */
export function nextTypeStatement(db: Db, types: readonly string[] | undefined, now: string) {
  return db
    .select({ type: workItems.type })
    .from(workItems)
    .where(and(inQueue, free(now), types ? inArray(workItems.type, [...types]) : undefined))
    .orderBy(...queueOrder)
    .limit(1)
}

/**
 * Leases the first `limit` free items of one type in queue order and records the gap each was
 * claimed with, in one statement: D1 runs statements one at a time, so two concurrent claims never
 * lease the same item. An expired lease is free.
 */
export function leaseStatement(
  db: Db,
  lease: Pick<WorkLease, 'id' | 'holder' | 'type' | 'expiresAt'>,
  limit: number,
  now: string,
) {
  const next = db
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(inQueue, free(now), eq(workItems.type, lease.type)))
    .orderBy(...queueOrder)
    .limit(limit)
  return db
    .update(workItems)
    .set({
      leaseId: lease.id,
      leaseHolder: lease.holder,
      leaseExpiresAt: lease.expiresAt,
      claimedGap: sql`${workItems.gap}`,
    })
    .where(inArray(workItems.id, next))
    .returning()
}

const staleColumns = { entryId: worklist.entryId, revision: worklist.revision }
const isStale = ne(worklist.revision, worklist.scoredRevision)
const toStale = (row: { entryId: string; revision: number }): StaleWork => ({
  entryId: row.entryId as EntryId,
  revision: row.revision,
})

export function createWorkRepo(db: Db): WorkRepo {
  return {
    async listStale(nodeIds) {
      const rows = await db
        .select(staleColumns)
        .from(worklist)
        .where(and(isStale, relatedWorklistRows(db, nodeIds)))
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

    async countStale() {
      const [row] = await db.select({ count: count() }).from(worklist).where(isStale)
      return row?.count ?? 0
    },

    async listItems(entryId) {
      const rows = await db.select().from(workItems).where(eq(workItems.entryId, entryId))
      return rows.map(toWorkItem)
    },

    async findItems(itemIds) {
      if (itemIds.length === 0) return []
      const rows = await db
        .select()
        .from(workItems)
        .where(inArray(workItems.id, [...itemIds]))
      return rows.map(toWorkItem)
    },

    async saveAssessment(stale, { completeness, credibility, slots }, { writes, deletes, verdicts }) {
      // One batch, each statement conditional on the revision the rescore read: a write that bumped
      // it since leaves the scores and the items as they were, and its own rescore follows.
      const current = exists(
        db
          .select({ one: sql`1` })
          .from(worklist)
          .where(and(eq(worklist.entryId, stale.entryId), eq(worklist.revision, stale.revision))),
      )
      const now = new Date().toISOString()
      const rows = writes.map((write) => ({
        ...write,
        id: write.id ?? crypto.randomUUID(),
        gap: JSON.stringify(write.gap),
      }))
      const field = (name: string) => sql`json_extract(value, ${`$.${name}`})`
      const upsert = db
        .insert(workItems)
        .select(
          db
            .select({
              id: field('id').as('id'),
              entryId: sql`${stale.entryId}`.as('entry_id'),
              type: field('type').as('type'),
              subjectId: field('subjectId').as('subject_id'),
              gap: field('gap').as('gap'),
              stage: field('stage').as('stage'),
              rank: field('rank').as('rank'),
              zipfOrder: field('zipfOrder').as('zipf_order'),
              awaiting: field('awaiting').as('awaiting'),
              attempts: field('attempts').as('attempts'),
              worked: field('worked').as('worked'),
              foundNone: field('foundNone').as('found_none'),
              claimedGap: sql`null`.as('claimed_gap'),
              leaseId: sql`null`.as('lease_id'),
              leaseHolder: sql`null`.as('lease_holder'),
              leaseExpiresAt: sql`null`.as('lease_expires_at'),
              lastWorkedAt: sql`null`.as('last_worked_at'),
              lastWorkedBy: sql`null`.as('last_worked_by'),
              lastNote: sql`null`.as('last_note'),
              createdAt: sql`${now}`.as('created_at'),
            })
            .from(sql`json_each(${JSON.stringify(rows)})`)
            .where(current),
        )
        .onConflictDoUpdate({
          target: [workItems.type, workItems.subjectId],
          set: {
            gap: sql`excluded.gap`,
            stage: sql`excluded.stage`,
            rank: sql`excluded.rank`,
            zipfOrder: sql`excluded.zipf_order`,
            awaiting: sql`excluded.awaiting`,
            attempts: sql`excluded.attempts`,
            worked: sql`excluded.worked`,
            foundNone: sql`excluded.found_none`,
          },
        })
      // The history row of every item written: inserted with a new item, its gap refreshed after.
      const log = db
        .insert(workItemLog)
        .select(
          db
            .select({
              id: workItems.id,
              entryId: workItems.entryId,
              type: workItems.type,
              subjectId: workItems.subjectId,
              gap: workItems.gap,
              createdAt: workItems.createdAt,
              closedAt: sql`null`.as('closed_at'),
              backfilled: sql`0`.as('backfilled'),
            })
            .from(workItems)
            .where(
              and(
                inIds(
                  workItems.id,
                  rows.map((row) => row.id),
                ),
                current,
              ),
            ),
        )
        .onConflictDoUpdate({ target: workItemLog.id, set: { gap: sql`excluded.gap` } })
      // A slot whose pass found none is filled by the pass: record it before the item goes.
      const passedIds = verdicts.filter((verdict) => verdict.verdict === 'passed').map((verdict) => verdict.id)
      const pass = db
        .insert(workPasses)
        .select(
          db
            .select({
              entryId: workItems.entryId,
              type: workItems.type,
              subjectId: workItems.subjectId,
              note: sql`coalesce(${workItems.lastNote}, 'found none')`.as('note'),
              holder: sql`coalesce(${workItems.lastWorkedBy}, 'unknown')`.as('holder'),
              createdAt: sql`${now}`.as('created_at'),
            })
            .from(workItems)
            .where(and(inIds(workItems.id, passedIds), current)),
        )
        .onConflictDoNothing()
      // An item its passes did not fill is a ticket on its node, one open ticket per node and type.
      const stuck = verdicts
        .filter((verdict) => verdict.verdict === 'stuck')
        .map((verdict) => ({ ticket: crypto.randomUUID(), item: verdict.id }))
      const raise = db
        .insert(tickets)
        .select(
          db
            .select({
              id: sql`json_extract(value, '$.ticket')`.as('id'),
              type: sql`'stuck_work'`.as('type'),
              targetType: sql`case when ${workItems.subjectId} = ${workItems.entryId} then 'entry' else 'sense' end`.as(
                'target_type',
              ),
              target: workItems.subjectId,
              message: sql`${workItems.type} || ': ' || coalesce(${workItems.lastNote}, 'no note')`.as('message'),
              status: sql`'open'`.as('status'),
              resolutionNote: sql`null`.as('resolution_note'),
              resolutionFactIds: sql`'[]'`.as('resolution_fact_ids'),
              revision: sql`0`.as('revision'),
              createdAt: sql`${now}`.as('created_at'),
              updatedAt: sql`${now}`.as('updated_at'),
            })
            .from(sql`json_each(${JSON.stringify(stuck)})`)
            .innerJoin(workItems, sql`${workItems.id} = json_extract(value, '$.item')`)
            .where(current),
        )
        .onConflictDoNothing()
      const remove = db.delete(workItems).where(and(inArray(workItems.id, [...deletes]), current))
      const close = db
        .update(workItemLog)
        .set({ closedAt: now })
        .where(and(inIds(workItemLog.id, deletes), isNull(workItemLog.closedAt), current))
      const judged = JSON.stringify(verdicts)
      const settle = db
        .update(workAttempts)
        .set({
          outcome: sql`(select json_extract(value, '$.verdict') from json_each(${judged}) where json_extract(value, '$.id') = ${workAttempts.itemId})`,
          settledAt: now,
        })
        .where(
          and(
            inIds(
              workAttempts.itemId,
              verdicts.map((verdict) => verdict.id),
            ),
            eq(workAttempts.outcome, 'waiting_on_review'),
            current,
          ),
        )
      const score = db
        .update(worklist)
        .set({
          completeness,
          credibility,
          slotsTotal: slots.total,
          slotsPublished: slots.published,
          slotsPending: slots.pending,
          scoredRevision: stale.revision,
        })
        .where(and(eq(worklist.entryId, stale.entryId), eq(worklist.revision, stale.revision)))
      await db.batch([upsert, log, pass, raise, remove, close, settle, score])
    },

    async claim(draft, types, limit, now) {
      const [next] = await nextTypeStatement(db, types, now)
      if (!next) return null
      const type = workTypeSchema.parse(next.type)
      const rows = await leaseStatement(db, { ...draft, type }, limit, now)
      if (rows.length === 0) return null
      const items = rows.map(toWorkItem)
      const lease: WorkLease = {
        ...draft,
        type,
        entryIds: [...new Set(items.map((item) => item.entryId))],
        itemIds: items.map((item) => item.id),
        claimedAt: now,
      }
      await db.insert(workLeases).values({
        id: lease.id,
        holder: lease.holder,
        type: lease.type,
        entryIds: JSON.stringify(lease.entryIds),
        itemIds: JSON.stringify(lease.itemIds),
        claimedAt: lease.claimedAt,
        expiresAt: lease.expiresAt,
      })
      return { lease, items: items.sort((a, b) => compareQueue(a, b)) }
    },

    async findLease(id) {
      const row = await db.select().from(workLeases).where(eq(workLeases.id, id)).get()
      return row ? toLease(row) : null
    },

    async complete(lease, worked, at) {
      // One batch, every statement conditional on the lease still being held: an expired lease
      // changes nothing, and the delete that comes last says whether it was held.
      const held = and(eq(workLeases.id, lease.id), eq(workLeases.holder, lease.holder), gt(workLeases.expiresAt, at))
      const stillHeld = exists(db.select({ one: sql`1` }).from(workLeases).where(held))
      const notes = JSON.stringify(
        worked.map((item) => ({
          id: item.id,
          note: item.note ?? null,
          foundNone: item.foundNone,
          attempt: crypto.randomUUID(),
        })),
      )
      // Qualified: a bare "id" inside the subquery names json_each's own id column.
      const named = (column: string) =>
        sql`(select json_extract(value, ${`$.${column}`}) from json_each(${notes}) where json_extract(value, '$.id') = "work_item_log"."id")`
      // An attempt per item named, from the history row, so an item the pass's own facts already
      // closed is recorded closed; the lease's time is shared among the items named.
      const seconds = (Date.parse(at) - Date.parse(lease.claimedAt)) / 1000 / Math.max(worked.length, 1)
      const attempts = db.insert(workAttempts).select(
        db
          .select({
            id: named('attempt').as('id'),
            itemId: workItemLog.id,
            entryId: workItemLog.entryId,
            type: workItemLog.type,
            subjectId: workItemLog.subjectId,
            holder: sql`${lease.holder}`.as('holder'),
            leaseId: sql`${lease.id}`.as('lease_id'),
            claimedAt: sql`${lease.claimedAt}`.as('claimed_at'),
            completedAt: sql`${at}`.as('completed_at'),
            seconds: sql`${seconds}`.as('seconds'),
            note: named('note').as('note'),
            outcome: sql`case when ${workItemLog.closedAt} is null then 'waiting_on_review' else 'closed' end`.as(
              'outcome',
            ),
            settledAt: sql`case when ${workItemLog.closedAt} is null then null else ${at} end`.as('settled_at'),
          })
          .from(workItemLog)
          .where(
            and(
              inArray(
                workItemLog.id,
                worked.map((item) => item.id),
              ),
              stillHeld,
            ),
          ),
      )
      const markWorked = db
        .update(workItems)
        .set({
          worked: true,
          lastWorkedAt: at,
          lastWorkedBy: lease.holder,
          lastNote: sql`(select json_extract(value, '$.note') from json_each(${notes}) where json_extract(value, '$.id') = ${workItems.id})`,
          foundNone: sql`coalesce((select json_extract(value, '$.foundNone') from json_each(${notes}) where json_extract(value, '$.id') = ${workItems.id}), 0)`,
        })
        .where(
          and(
            eq(workItems.leaseId, lease.id),
            inArray(
              workItems.id,
              worked.map((item) => item.id),
            ),
            stillHeld,
          ),
        )
      // The words a pass was blocked on, so importing one reopens the slot.
      const blocks = JSON.stringify(worked.flatMap((item) => item.blockedOn.map((lemma) => ({ id: item.id, lemma }))))
      const block = db
        .insert(workPassBlocks)
        .select(
          db
            .select({
              lemma: sql`json_extract(value, '$.lemma')`.as('lemma'),
              type: workItems.type,
              subjectId: workItems.subjectId,
            })
            .from(sql`json_each(${blocks})`)
            .innerJoin(workItems, sql`${workItems.id} = json_extract(value, '$.id')`)
            .where(stillHeld),
        )
        .onConflictDoNothing()
      const release = db
        .update(workItems)
        .set({ leaseId: null, leaseHolder: null, leaseExpiresAt: null })
        .where(and(eq(workItems.leaseId, lease.id), stillHeld))
      const bump = db
        .update(worklist)
        .set({ ...bumpRevision, lastWorkedAt: at })
        .where(and(inArray(worklist.entryId, [...lease.entryIds]), stillHeld))
      const remove = db.delete(workLeases).where(held).returning({ id: workLeases.id })
      const [, , , , , removed] = await db.batch([attempts, markWorked, block, release, bump, remove])
      return removed.length > 0
    },

    async recordPass({ entryId, type, subjectId, note, holder, at }) {
      await db.batch([
        db
          .insert(workPasses)
          .values({ entryId, type, subjectId, note, holder, createdAt: at })
          .onConflictDoUpdate({
            target: [workPasses.type, workPasses.subjectId],
            set: { note, holder, createdAt: at },
          }),
        db.update(worklist).set(bumpRevision).where(eq(worklist.entryId, entryId)),
      ])
    },

    async reopenBlocked(lemmas) {
      if (lemmas.length === 0) return 0
      const blocked = db
        .select({ key: sql`${workPassBlocks.type} || '|' || ${workPassBlocks.subjectId}` })
        .from(workPassBlocks)
        .where(inIds(workPassBlocks.lemma, lemmas))
      const passKey = sql`${workPasses.type} || '|' || ${workPasses.subjectId}`
      const reopened = await db
        .select({ entryId: workPasses.entryId })
        .from(workPasses)
        .where(inArray(passKey, blocked))
      if (reopened.length === 0) return 0
      await db.batch([
        db.delete(workPasses).where(inArray(passKey, blocked)),
        db.delete(workPassBlocks).where(inIds(workPassBlocks.lemma, lemmas)),
        db
          .update(worklist)
          .set(bumpRevision)
          .where(
            inIds(
              worklist.entryId,
              reopened.map((row) => row.entryId),
            ),
          ),
      ])
      return reopened.length
    },

    async purgeLeases(before) {
      const rows = await db.delete(workLeases).where(lte(workLeases.expiresAt, before)).returning({ id: workLeases.id })
      return rows.length
    },
  }
}

/** Queue order of two items: rank, then the more frequent entry, then the older item. */
function compareQueue(a: WorkItem, b: WorkItem): number {
  return a.rank - b.rank || b.zipfOrder - a.zipfOrder || a.id.localeCompare(b.id)
}
