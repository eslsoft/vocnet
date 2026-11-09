import { createRoute } from '@hono/zod-openapi'
import { issueAgent, listAgents, revokeAgent } from '@server/usecases/agents'
import { agentIdSchema, agentListSchema, agentSchema, issueAgentInputSchema, issuedAgentSchema } from '@shared/agents'
import { z } from 'zod'
import { actorOf, requireAdmin } from '../auth'
import { createRouter, errorResponse, json, jsonBody } from '../router'
import { agentDto } from '../serialize'

const tags = ['Agents']
const middleware = requireAdmin

const listRoute = createRoute({
  method: 'get',
  path: '/agents',
  tags,
  middleware,
  summary: 'List agents (admins)',
  responses: { 200: json(agentListSchema, 'All agents.'), 403: errorResponse },
})

const issueRoute = createRoute({
  method: 'post',
  path: '/agents',
  tags,
  middleware,
  summary: 'Issue an agent API key (admins)',
  request: { body: jsonBody(issueAgentInputSchema) },
  responses: {
    201: json(issuedAgentSchema, 'The agent and its key, shown once.'),
    400: errorResponse,
    403: errorResponse,
  },
})

const revokeRoute = createRoute({
  method: 'delete',
  path: '/agents/{id}',
  tags,
  middleware,
  summary: "Revoke an agent's key (admins)",
  request: { params: z.object({ id: agentIdSchema }) },
  responses: { 200: json(agentSchema, 'The revoked agent.'), 403: errorResponse, 404: errorResponse },
})

export const agentRoutes = createRouter()
  .openapi(listRoute, async (c) => c.json({ items: (await listAgents(c.get('deps'))).map(agentDto) }, 200))
  .openapi(issueRoute, async (c) => {
    const { agent, key } = await issueAgent(c.get('deps'), actorOf(c), c.req.valid('json'))
    return c.json({ agent: agentDto(agent), key }, 201)
  })
  .openapi(revokeRoute, async (c) => c.json(agentDto(await revokeAgent(c.get('deps'), c.req.valid('param').id)), 200))
