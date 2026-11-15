import { createRoute } from '@hono/zod-openapi'
import { issueService, listServices, revokeService } from '@server/usecases/services'
import {
  issuedServiceSchema,
  issueServiceInputSchema,
  serviceIdSchema,
  serviceListSchema,
  serviceSchema,
} from '@shared/services'
import { z } from 'zod'
import { actorOf, requireAdmin } from '../auth'
import { createRouter, errorResponse, json, jsonBody } from '../router'
import { serviceDto } from '../serialize'

const tags = ['Services']
const middleware = requireAdmin

const listRoute = createRoute({
  method: 'get',
  path: '/services',
  tags,
  middleware,
  summary: 'List services (admins)',
  responses: { 200: json(serviceListSchema, 'All services.'), 403: errorResponse },
})

const issueRoute = createRoute({
  method: 'post',
  path: '/services',
  tags,
  middleware,
  summary: 'Issue a service key for public reads (admins)',
  description:
    'A downstream service sends the key as Authorization: Bearer vn_service_… on GET /v1: its reads are counted against the per-service limit, not the per-address one, and logged under its name. The key grants nothing on the management API.',
  request: { body: jsonBody(issueServiceInputSchema) },
  responses: {
    201: json(issuedServiceSchema, 'The service and its key, shown once.'),
    400: errorResponse,
    403: errorResponse,
  },
})

const revokeRoute = createRoute({
  method: 'delete',
  path: '/services/{id}',
  tags,
  middleware,
  summary: "Revoke a service's key (admins)",
  request: { params: z.object({ id: serviceIdSchema }) },
  responses: { 200: json(serviceSchema, 'The revoked service.'), 403: errorResponse, 404: errorResponse },
})

export const serviceRoutes = createRouter()
  .openapi(listRoute, async (c) => c.json({ items: (await listServices(c.get('deps'))).map(serviceDto) }, 200))
  .openapi(issueRoute, async (c) => {
    const { service, key } = await issueService(c.get('deps'), actorOf(c), c.req.valid('json'))
    return c.json({ service: serviceDto(service), key }, 201)
  })
  .openapi(revokeRoute, async (c) =>
    c.json(serviceDto(await revokeService(c.get('deps'), c.req.valid('param').id)), 200),
  )
