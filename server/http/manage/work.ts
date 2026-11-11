import { createRoute } from '@hono/zod-openapi'
import type { PrincipalRef } from '@server/domain/principal'
import type { Lemma } from '@server/domain/term'
import type { WorkItem } from '@server/domain/work'
import type { WorkContext } from '@server/domain/work-context'
import { getWorkItem, getWorkSummary, listOpenWorkItems, listWorkAttempts } from '@server/usecases/monitor'
import { claimWork, completeWork, listCurationItems } from '@server/usecases/work'
import { rescoreStaleWork } from '@server/usecases/work-scores'
import { lemmaInputSchema } from '@shared/catalog'
import { entryIdSchema } from '@shared/facts'
import {
  workAttemptOutcomeSchema,
  workAttemptPageSchema,
  workItemDetailSchema,
  workItemOverviewListSchema,
  workSummarySchema,
  workWindowSchema,
} from '@shared/monitor'
import {
  claimWorkInputSchema,
  completeWorkInputSchema,
  curationPageSchema,
  workClaimSchema,
  workCompletionSchema,
  workItemIdSchema,
  workLeaseIdSchema,
  workRescoreInputSchema,
  workRescoreResultSchema,
  workTypeSchema,
} from '@shared/work'
import { z } from 'zod'
import { actorOf, requireAdmin } from '../auth'
import { createRouter, errorResponse, json, jsonBody, pageQuery } from '../router'
import { factDto, managedEntryDto } from '../serialize'

const tags = ['Work']

// The claim body is optional: a POST without a JSON body uses the defaults.
const optionalBody = <T extends z.ZodType>(schema: T) => ({
  required: false,
  content: { 'application/json': { schema } },
})

const claimRoute = createRoute({
  method: 'post',
  path: '/work/claim',
  tags,
  summary: 'Lease the next work items of one type',
  description:
    'Leases up to `limit` items, all of one type: the type of the highest-priority free item of the production ' +
    'queue (within `types` when given), then the next free items of that type. Priority is the policy stage of ' +
    'the type (1 identity, 2 meaning, 3 usage, 4 network, 5 weak facts), then the learner band of the entry ' +
    '(CEFR A1 to C2, then a frequency without a level, then the rest), then the higher frequency. An item is ' +
    'in the queue while no pending fact can change it and fewer than three passes left it unchanged. Each item ' +
    'comes with its gap and the context its type needs. Two concurrent claims never lease the same item. 204 ' +
    'means no item is free.',
  request: { body: optionalBody(claimWorkInputSchema) },
  responses: {
    200: json(workClaimSchema, 'The lease and its items.'),
    204: { description: 'No item is free to claim.' },
    400: errorResponse,
  },
})

const completeRoute = createRoute({
  method: 'post',
  path: '/work/{lease_id}/complete',
  tags,
  summary: 'Finish a pass over leased items',
  description:
    'Only the holder, before the lease expires. The items named were worked; the rest of the lease is released ' +
    'without an attempt. Rescores the entries of the lease and reports where each named item stands: closed, ' +
    'open, awaiting_review (judged once its pending facts are reviewed), or curation (three passes left it ' +
    'unchanged). Completing the same lease again answers 404; an item the lease did not claim is 422.',
  request: { params: z.object({ lease_id: workLeaseIdSchema }), body: jsonBody(completeWorkInputSchema) },
  responses: {
    200: json(workCompletionSchema, 'Where each worked item stands.'),
    400: errorResponse,
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
})

const curationRoute = createRoute({
  method: 'get',
  path: '/work/curation',
  tags,
  summary: 'List the items the producers could not fill (curators)',
  description:
    'Items that three completed passes left as their claims found them, in queue order. A curator fills or ' +
    'settles them with curated facts (see Curation); any change to an item puts it back in the production queue.',
  request: { query: pageQuery.extend({ type: workTypeSchema.optional() }) },
  responses: {
    200: json(curationPageSchema, 'A page of items.'),
    400: errorResponse,
    403: errorResponse,
  },
})

const rescoreRoute = createRoute({
  method: 'post',
  path: '/work/rescore',
  tags,
  middleware: requireAdmin,
  summary: 'Rescore stale worklist rows (admins)',
  description:
    'Rescores up to `limit` worklist rows whose stored scores and work items are older than their facts or the gap ' +
    'rules, as the cron does 100 at a time. A release that changes the gap rules marks every row stale; repeat ' +
    'until `remaining` is 0 to drain it.',
  request: { body: jsonBody(workRescoreInputSchema) },
  responses: {
    200: json(workRescoreResultSchema, 'What this call rescored and what is left.'),
    400: errorResponse,
    403: errorResponse,
  },
})

const summaryRoute = createRoute({
  method: 'get',
  path: '/work/summary',
  tags,
  middleware: requireAdmin,
  summary: 'How fast the agents close the open work (admins)',
  description:
    'Open items by status and type; items created and closed per hour over the last 24 hours (`24h`) or per day ' +
    'over the last 7 days (`7d`), counted from the start of the first bucket; attempt times and success by type ' +
    'within the window; the backlog trend over the last 7 days and 24 hours, overall and by lowest CEFR level; ' +
    'and the leases of the last day, at most 100.',
  request: { query: z.object({ window: workWindowSchema.default('24h') }) },
  responses: {
    200: json(workSummarySchema, 'The summary.'),
    400: errorResponse,
    403: errorResponse,
  },
})

const attemptsRoute = createRoute({
  method: 'get',
  path: '/work/attempts',
  tags,
  middleware: requireAdmin,
  summary: 'List completed attempts, latest first (admins)',
  description:
    "Every item a completion named, with its outcome once the rescore judged it and the facts its holder submitted about the item's node between the claim and the completion. `lemma` matches only the entry spelled exactly so.",
  request: {
    query: pageQuery.extend({
      outcome: workAttemptOutcomeSchema.optional(),
      type: workTypeSchema.optional(),
      holder: z
        .string()
        .min(1)
        .optional()
        .meta({ description: 'Only attempts by this principal (agent:… or oidc:…).' }),
      lemma: lemmaInputSchema.optional(),
    }),
  },
  responses: {
    200: json(workAttemptPageSchema, 'A page of attempts.'),
    400: errorResponse,
    403: errorResponse,
  },
})

const itemsRoute = createRoute({
  method: 'get',
  path: '/work/items',
  tags,
  middleware: requireAdmin,
  summary: "List an entry's or a node's open work items (admins)",
  description:
    'Exactly one of `entry_id` (every open item of the entry) and `subject_id` (the open items about one entry, sense, or weak fact), in queue order.',
  request: {
    query: z
      .object({ entry_id: entryIdSchema.optional(), subject_id: z.uuid().optional() })
      .refine((query) => (query.entry_id === undefined) !== (query.subject_id === undefined), {
        message: 'Give exactly one of entry_id and subject_id.',
      }),
  },
  responses: {
    200: json(workItemOverviewListSchema, 'The open items.'),
    400: errorResponse,
    403: errorResponse,
  },
})

const itemRoute = createRoute({
  method: 'get',
  path: '/work/items/{id}',
  tags,
  middleware: requireAdmin,
  summary: 'Get one work item, open or closed, with its attempts (admins)',
  request: { params: z.object({ id: workItemIdSchema }) },
  responses: {
    200: json(workItemDetailSchema, 'The item.'),
    403: errorResponse,
    404: errorResponse,
  },
})

const itemDto = (item: WorkItem, lemma: string) => ({
  id: item.id,
  type: item.type,
  entry_id: item.entryId,
  lemma,
  subject_id: item.subjectId,
  stage: item.stage,
  attempts: item.attempts,
  gap: item.gap,
})

const contextSenseDto = (sense: WorkContext['entry']['senses'][number]) => ({
  id: sense.id,
  pos: sense.pos,
  gloss: sense.gloss,
  register: sense.register,
  region: sense.region,
  rare: sense.rare,
  status: sense.status,
})

const contextDto = (context: WorkContext) => ({
  entry: { ...context.entry, senses: context.entry.senses.map(contextSenseDto) },
  sense: context.sense && contextSenseDto(context.sense),
  facts: context.facts.map(factDto),
  related: context.related.map((sense) => ({
    sense_id: sense.senseId,
    lemma: sense.lemma,
    pos: sense.pos,
    gloss: sense.gloss,
  })),
  view: context.view && managedEntryDto(context.view),
  criteria: context.criteria,
})

export const manageWorkRoutes = createRouter()
  .openapi(summaryRoute, async (c) => c.json(await getWorkSummary(c.get('deps'), c.req.valid('query').window), 200))
  .openapi(attemptsRoute, async (c) => {
    const { outcome, type, holder, lemma, limit, cursor } = c.req.valid('query')
    const filter = { outcome, type, holder: holder as PrincipalRef | undefined, lemma: lemma as Lemma | undefined }
    const page = await listWorkAttempts(c.get('deps'), filter, { limit, cursor })
    return c.json({ items: page.items, next_cursor: page.nextCursor }, 200)
  })
  .openapi(itemsRoute, async (c) => {
    const { entry_id, subject_id } = c.req.valid('query')
    const by = entry_id ? { entryId: entry_id } : { subjectId: subject_id! }
    return c.json({ items: await listOpenWorkItems(c.get('deps'), by) }, 200)
  })
  .openapi(itemRoute, async (c) => c.json(await getWorkItem(c.get('deps'), c.req.valid('param').id), 200))
  .openapi(rescoreRoute, async (c) => c.json(await rescoreStaleWork(c.get('deps'), c.req.valid('json').limit), 200))
  .openapi(claimRoute, async (c) => {
    // Without a body the validator is skipped, so the defaults are applied here.
    const claim = await claimWork(c.get('deps'), actorOf(c), claimWorkInputSchema.parse(c.req.valid('json')))
    if (!claim) return c.body(null, 204)
    const { lease } = claim
    return c.json(
      {
        lease: { id: lease.id, type: lease.type, holder: lease.holder, expires_at: lease.expiresAt },
        items: claim.items.map(({ item, lemma, context }) => ({
          ...itemDto(item, lemma),
          context: contextDto(context),
        })),
      },
      200,
    )
  })
  .openapi(completeRoute, async (c) => {
    const done = await completeWork(c.get('deps'), actorOf(c), c.req.valid('param').lease_id, c.req.valid('json'))
    return c.json({ lease_id: done.leaseId, items: done.items }, 200)
  })
  .openapi(curationRoute, async (c) => {
    const { type, limit, cursor } = c.req.valid('query')
    const page = await listCurationItems(c.get('deps'), actorOf(c), type ?? null, { limit, cursor })
    return c.json(
      {
        items: page.items.map((item) => ({
          ...itemDto(item, item.lemma),
          last_worked_at: item.lastWorkedAt,
          last_worked_by: item.lastWorkedBy,
          last_note: item.lastNote,
        })),
        next_cursor: page.nextCursor,
      },
      200,
    )
  })
