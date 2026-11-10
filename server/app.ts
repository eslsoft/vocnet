import { $ } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { requireStaff } from './http/auth'
import { publicRoutes } from './http/catalog'
import { configRoutes } from './http/config'
import { onError, onNotFound } from './http/errors'
import { agentRoutes } from './http/manage/agents'
import { manageCatalogRoutes } from './http/manage/catalog'
import { manageFactRoutes } from './http/manage/facts'
import { manageFeedbackRoutes } from './http/manage/feedback'
import { managePublicViewRoutes } from './http/manage/public-view'
import { manageWorkRoutes } from './http/manage/work'
import { createRouter } from './http/router'
import { topicRoutes } from './http/topics'

// Routes are chained so their types flow into `AppType` for the SPA's RPC client.
// Per-request deps are wired by the worker; see server/worker.ts.

const publicV1 = createRouter().route('/', publicRoutes).route('/', topicRoutes)

const manageV1 = createRouter()
  .route('/', manageCatalogRoutes)
  .route('/', manageFactRoutes)
  .route('/', manageFeedbackRoutes)
  .route('/', manageWorkRoutes)
  .route('/', managePublicViewRoutes)
  .route('/', agentRoutes)
manageV1.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
  type: 'http',
  scheme: 'bearer',
  description: 'An agent API key (vn_agent_...) or an admin OIDC access token.',
})

const info = (title: string, description: string) => ({ title, version: '1.0.0', description })

// The documents are static, so they are built once per isolate.
const publicDocument = publicV1.getOpenAPI31Document({
  openapi: '3.1.0',
  info: info('Vocnet API', 'A relational English dictionary. Every item is a reviewed fact with its confidence.'),
  servers: [{ url: '/v1' }],
})
const manageDocument = manageV1.getOpenAPI31Document({
  openapi: '3.1.0',
  info: info(
    'Vocnet management API',
    'For agents and admins: submit facts, review state, claim entries to work on, and work through feedback.',
  ),
  servers: [{ url: '/manage/v1' }],
  security: [{ bearer: [] }],
})

const manage = $(createRouter().use('*', requireStaff))
  .get('/openapi.json', (c) => c.json(manageDocument))
  .route('/v1', manageV1)

export const app = createRouter()
  .onError(onError)
  .notFound(onNotFound)
  .route('/', configRoutes)
  .get('/openapi.json', (c) => c.json(publicDocument))
  .get('/docs', Scalar({ url: '/openapi.json', pageTitle: 'Vocnet API' }))
  .route('/v1', publicV1)
  .route('/manage', manage)

export type AppType = typeof app
