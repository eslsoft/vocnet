import { ExpectedError } from '@server/usecases/errors'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from './context'
import { errorPayload } from './responses'

// One place to map thrown errors to a consistent JSON shape. Routes throw
// HTTPException for expected failures; anything else is an unexpected 500.
export function onError<E extends AppEnv>(err: Error, c: Context<E>) {
  if (err instanceof ExpectedError) return c.json(errorPayload(err.code, err.message), err.status)
  if (err instanceof HTTPException) return c.json(errorPayload('invalid_request', err.message), err.status)
  c.set('unexpectedError', err)
  return c.json(errorPayload('internal_error', 'Internal server error.'), 500)
}
