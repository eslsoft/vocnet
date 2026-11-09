import { isAgentKey } from '@server/domain/principal'
import { authenticateStaff, requireAdminPrincipal } from '@server/usecases/access'
import { AuthenticationRequiredError } from '@server/usecases/errors'
import type { Actor } from '@server/usecases/facts'
import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv } from './context'

/** Agents (by API key) and admins (by OIDC access token) may use the management API. */
export const requireStaff: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (!token) throw new AuthenticationRequiredError()
  c.set('authMethod', isAgentKey(token) ? 'agent_key' : 'oidc')
  c.set('principal', await authenticateStaff(c.get('deps'), token))
  await next()
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  requireAdminPrincipal(c.get('principal'))
  await next()
}

export function actorOf(c: Context<AppEnv>): Actor {
  return { principal: c.get('principal'), traceId: c.get('traceId') }
}
