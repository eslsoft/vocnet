import { InvalidCredentialError } from '@server/usecases/errors'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from './context'
import { errorPayload } from './responses'

// Verifies the bearer token via the injected AuthVerifier and sets the user.
// Apply to the routes that require authentication.
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (!token) return c.json(errorPayload('authentication_required', 'Authentication required.'), 401)

  try {
    c.set('user', await c.get('deps').authVerifier.verify(token))
    c.set('authMethod', 'bearer')
  } catch (error) {
    if (error instanceof InvalidCredentialError) {
      return c.json(errorPayload(error.code, error.message), error.status)
    }
    throw error
  }

  await next()
}
