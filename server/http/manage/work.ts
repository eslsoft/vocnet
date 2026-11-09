import { createRoute } from '@hono/zod-openapi'
import { claimWork, completeWork } from '@server/usecases/work'
import {
  claimWorkInputSchema,
  completeWorkInputSchema,
  workClaimSchema,
  workCompletionSchema,
  workLeaseIdSchema,
} from '@shared/work'
import { z } from 'zod'
import { actorOf } from '../auth'
import { createRouter, errorResponse, json } from '../router'
import { managedEntryDto } from '../serialize'

const tags = ['Work']

// Both bodies are optional: a POST without a JSON body uses the defaults.
const optionalBody = <T extends z.ZodType>(schema: T) => ({
  required: false,
  content: { 'application/json': { schema } },
})

const claimRoute = createRoute({
  method: 'post',
  path: '/work/claim',
  tags,
  summary: 'Lease the next entry to work on',
  description:
    'Picks the least recently claimed entry whose entry fact is live and that no unexpired lease holds, and ' +
    'returns it with the gaps its live facts leave. Two concurrent claims never get the same entry.',
  request: { body: optionalBody(claimWorkInputSchema) },
  responses: {
    200: json(workClaimSchema, 'The lease, the entry, and its gaps.'),
    204: { description: 'No entry is free to claim.' },
    400: errorResponse,
  },
})

const completeRoute = createRoute({
  method: 'post',
  path: '/work/{lease_id}/complete',
  tags,
  summary: 'Finish work on a leased entry',
  description:
    'Only the holder, before the lease expires. Records when the entry was worked and deletes the lease, ' +
    'so completing the same lease again answers 404.',
  request: { params: z.object({ lease_id: workLeaseIdSchema }), body: optionalBody(completeWorkInputSchema) },
  responses: {
    200: json(workCompletionSchema, 'The entry and when it was worked.'),
    400: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
})

export const manageWorkRoutes = createRouter()
  .openapi(claimRoute, async (c) => {
    const claim = await claimWork(c.get('deps'), actorOf(c), c.req.valid('json').lease_seconds)
    if (!claim) return c.body(null, 204)
    const { lease } = claim
    return c.json(
      {
        lease: {
          id: lease.id,
          entry_id: lease.entryId,
          lemma: lease.lemma,
          holder: lease.holder,
          expires_at: lease.expiresAt,
        },
        entry: managedEntryDto(claim.entry),
        gaps: claim.gaps,
      },
      200,
    )
  })
  .openapi(completeRoute, async (c) => {
    const done = await completeWork(c.get('deps'), actorOf(c), c.req.valid('param').lease_id, c.req.valid('json'))
    return c.json({ entry_id: done.entryId, last_worked_at: done.lastWorkedAt }, 200)
  })
