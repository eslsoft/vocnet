import { getAuthConfig } from '@server/config'
import type { ClientConfig } from '@shared/types'
import { Hono } from 'hono'
import type { AppEnv } from './context'

// Public runtime config for the admin console. Expose ONLY public values, never secrets.
export const configRoutes = new Hono<AppEnv>().get('/configz', (c) => {
  const auth = getAuthConfig(c.env)
  const config: ClientConfig = { oidc: { issuer: auth.issuer, client_id: auth.clientId } }
  return c.json(config)
})
