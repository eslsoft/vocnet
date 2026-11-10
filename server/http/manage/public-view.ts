import { createRoute } from '@hono/zod-openapi'
import { rebuildStalePublicViews } from '@server/usecases/public-view'
import { publicRebuildInputSchema, publicRebuildResultSchema } from '@shared/public-view'
import { requireAdmin } from '../auth'
import { createRouter, errorResponse, json, jsonBody } from '../router'

const rebuild = createRoute({
  method: 'post',
  path: '/public/rebuild',
  tags: ['Public view'],
  middleware: requireAdmin,
  summary: 'Rebuild stale public views (admins)',
  description:
    'Rebuilds up to `limit` entries whose public view is older than their facts or reference data, as the cron ' +
    'does 100 at a time. Repeat until `remaining` is 0 to drain a backfill or a reference import.',
  request: { body: jsonBody(publicRebuildInputSchema) },
  responses: {
    200: json(publicRebuildResultSchema, 'What this call rebuilt and what is left.'),
    400: errorResponse,
    403: errorResponse,
  },
})

export const managePublicViewRoutes = createRouter().openapi(rebuild, async (c) =>
  c.json(await rebuildStalePublicViews(c.get('deps'), c.req.valid('json').limit), 200),
)
