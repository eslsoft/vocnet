import { z } from 'zod'
import { entryIdSchema, factIdSchema, factKindSchema, factStatusSchema } from './facts'
import { cefrLevelSchema } from './reference'
import { gapSchema, workItemIdSchema, workLeaseIdSchema, workTypeSchema } from './work'

// Read-only views the console shows admins: how complete and reliable the dictionary is, and how
// fast the agents are closing its open work. Every number derives from stored rows on read.

const count = z.number().int().nonnegative()
const seconds = z.number().nonnegative()
const ratio = z.number().min(0).max(1)

export const workWindowSchema = z.enum(['24h', '7d']).meta({ id: 'WorkWindow' })
export type WorkWindow = z.infer<typeof workWindowSchema>

/** Where an open item stands; `closed` only appears on an item's history once its gap is gone. */
export const workItemStatusSchema = z.enum(['queued', 'in_progress', 'waiting_on_review', 'stuck', 'closed']).meta({
  id: 'WorkItemStatus',
  description:
    'queued: in the production queue. in_progress: leased by an agent. waiting_on_review: facts that may fill it are pending. stuck: three attempts made no progress, so it waits for a curator. closed: the gap is gone.',
})
export type WorkItemStatus = z.infer<typeof workItemStatusSchema>

export const workAttemptOutcomeSchema = z
  .enum(['waiting_on_review', 'closed', 'progressed', 'no_progress', 'stuck'])
  .meta({
    id: 'WorkAttemptOutcome',
    description:
      'The verdict on one completed attempt at one item. waiting_on_review: its facts are pending, so the verdict waits for their reviews. closed: the gap is gone. progressed: the gap changed but stays open. no_progress: the gap is as the claim found it. stuck: no progress, and that was the third attempt in a row.',
  })
export type WorkAttemptOutcome = z.infer<typeof workAttemptOutcomeSchema>

export const workOpenCountsSchema = z
  .object({ queued: count, in_progress: count, waiting_on_review: count, stuck: count, total: count })
  .meta({ id: 'WorkOpenCounts' })
export type WorkOpenCounts = z.infer<typeof workOpenCountsSchema>

export const workTypeSummarySchema = z
  .object({
    type: workTypeSchema,
    stage: z.number().int().positive(),
    open: count,
    waiting_on_review: count,
    stuck: count,
    closed: count.meta({ description: 'Items of this type closed within the window.' }),
    median_attempt_seconds: seconds
      .nullable()
      .meta({ description: 'Median time an attempt within the window took; null without one.' }),
    success_rate: ratio.nullable().meta({
      description: 'Share of the settled attempts within the window that closed or progressed their item.',
    }),
  })
  .meta({ id: 'WorkTypeSummary' })

export const workThroughputBucketSchema = z
  .object({ start: z.iso.datetime(), created: count, closed: count })
  .meta({ id: 'WorkThroughputBucket', description: 'Items created and closed in one hour (24h) or one day (7d).' })

export const workLevelForecastSchema = z
  .object({
    level: cefrLevelSchema.nullable().meta({ description: "The entry's lowest CEFR level; null without one." }),
    open: count,
    net_per_day: z.number().nullable().meta({
      description:
        'Items closed minus items created per day, averaged over the recorded history of the last 7 days; null while less than a day is recorded.',
    }),
  })
  .meta({ id: 'WorkLevelForecast' })

export const workLeaseSummarySchema = z
  .object({
    id: workLeaseIdSchema,
    holder: z.string(),
    type: workTypeSchema,
    items: count,
    lemmas: z.array(z.string()).max(3).meta({ description: 'The first lemmas the lease covers.' }),
    claimed_at: z.iso.datetime(),
    expires_at: z.iso.datetime(),
    timed_out: z.boolean().meta({ description: 'It expired before its holder completed it.' }),
  })
  .meta({ id: 'WorkLeaseSummary' })

export const workSummarySchema = z
  .object({
    window: workWindowSchema,
    open: workOpenCountsSchema,
    history_since: z.iso.datetime().nullable().meta({
      description:
        'When the history began recording: the first item it saw open or close. Items already open when it began never count as created. Null before anything is recorded.',
    }),
    created: count.meta({ description: 'Items created within the window since the history began.' }),
    closed: count.meta({ description: 'Items closed within the window.' }),
    median_close_seconds: seconds
      .nullable()
      .meta({ description: 'Median time from created to closed of the items closed within the window.' }),
    agents: count.meta({ description: 'Distinct holders of an unexpired lease.' }),
    by_type: z.array(workTypeSummarySchema),
    throughput: z.array(workThroughputBucketSchema),
    forecast: z.object({
      net_per_day: z.number().nullable().meta({
        description:
          'Items closed minus created per day, averaged over the recorded history of the last 7 days; null while less than a day is recorded.',
      }),
      net_per_day_24h: z
        .number()
        .nullable()
        .meta({ description: 'The same over the last 24 hours; null while less than a day is recorded.' }),
      by_level: z.array(workLevelForecastSchema),
    }),
    leases: z.array(workLeaseSummarySchema).meta({
      description:
        'Unexpired leases and leases that expired within the last 24 hours, newest claim first, at most 100.',
    }),
  })
  .meta({ id: 'WorkSummary' })
export type WorkSummary = z.infer<typeof workSummarySchema>

export const workAttemptFactSchema = z
  .object({ id: factIdSchema, kind: factKindSchema, status: factStatusSchema, summary: z.string() })
  .meta({ id: 'WorkAttemptFact', description: 'A fact the holder submitted about the item during the attempt.' })

export const workAttemptSchema = z
  .object({
    id: z.uuid(),
    item_id: workItemIdSchema,
    attempt: z.number().int().positive().meta({
      description: "This attempt's 1-based ordinal among the item's completed attempts, by completion.",
    }),
    entry: z.object({ id: entryIdSchema, lemma: z.string() }),
    type: workTypeSchema,
    subject_id: z.uuid(),
    sense_gloss: z.string().nullable().meta({ description: 'The live gloss when the item is about a sense.' }),
    holder: z.string(),
    claimed_at: z.iso.datetime(),
    completed_at: z.iso.datetime(),
    seconds: seconds.meta({
      description: "The lease's time from claim to completion divided by the items the completion named.",
    }),
    outcome: workAttemptOutcomeSchema,
    note: z.string().nullable(),
    facts: z.array(workAttemptFactSchema),
  })
  .meta({ id: 'WorkAttempt' })
export type WorkAttemptDto = z.infer<typeof workAttemptSchema>

export const workAttemptPageSchema = z
  .object({ items: z.array(workAttemptSchema), next_cursor: z.string().nullable() })
  .meta({ id: 'WorkAttemptPage' })

export const workItemOverviewSchema = z
  .object({
    id: workItemIdSchema,
    type: workTypeSchema,
    stage: z.number().int().positive(),
    entry: z.object({ id: entryIdSchema, lemma: z.string() }),
    subject_id: z.uuid(),
    sense_gloss: z.string().nullable(),
    gap: gapSchema.meta({ description: 'The open gap, or for a closed item the gap it last had.' }),
    status: workItemStatusSchema,
    attempts_without_progress: count,
    lease: z.object({ holder: z.string(), expires_at: z.iso.datetime() }).nullable(),
    created_at: z.iso.datetime(),
    closed_at: z.iso.datetime().nullable(),
  })
  .meta({ id: 'WorkItemOverview' })
export type WorkItemOverview = z.infer<typeof workItemOverviewSchema>

export const workItemOverviewListSchema = z
  .object({ items: z.array(workItemOverviewSchema) })
  .meta({ id: 'WorkItemOverviewList' })

export const workItemDetailSchema = workItemOverviewSchema
  .extend({
    attempts: z.array(workAttemptSchema).meta({ description: 'Every completed attempt, newest first.' }),
    agent_seconds: seconds,
    queue_seconds: seconds.meta({
      description:
        "From created to the first attempt's claim; for an item never worked, to its close, or to now while open.",
    }),
  })
  .meta({ id: 'WorkItemDetail' })
export type WorkItemDetail = z.infer<typeof workItemDetailSchema>

export const levelCompletenessSchema = z
  .object({ level: cefrLevelSchema.nullable(), entries: count, complete: count, average: ratio })
  .meta({ id: 'LevelCompleteness' })

export const consoleStatsSchema = z
  .object({
    facts: z.array(z.object({ kind: factKindSchema, status: factStatusSchema, count })),
    flagged: z.array(z.object({ kind: factKindSchema, count })).meta({
      description: 'Weak facts by kind: published on an uncertain or failed review (the facts list `weak` filter).',
    }),
    live_facts: count,
    completeness: z.object({ average: ratio, by_level: z.array(levelCompletenessSchema) }),
    pending_review: z.object({
      count,
      oldest_at: z.iso.datetime().nullable(),
      over_one_hour: count,
    }),
    feedback: z
      .object({ open: count, claimed: count, resolved: count, dismissed: count })
      .meta({ description: 'Feedback by status.' }),
    work: z.object({ open: count, stuck: count, timed_out_24h: count }),
  })
  .meta({ id: 'ConsoleStats' })
export type ConsoleStats = z.infer<typeof consoleStatsSchema>
