import { OpenAPIHono } from '@hono/zod-openapi'
import { InvalidRequestError } from '@server/usecases/errors'
import { apiErrorSchema } from '@shared/types'
import { z } from 'zod'
import type { AppEnv } from './context'

/** Every router validates with the route's zod schemas and reports failures as invalid_request. */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        const detail = result.error.issues.map((issue) => `${issue.path.join('.') || result.target}: ${issue.message}`)
        throw new InvalidRequestError(`Invalid ${result.target}: ${detail.join('; ')}`)
      }
    },
  })
}

export function json<T extends z.ZodType>(schema: T, description: string) {
  return { content: { 'application/json': { schema } }, description }
}

export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
})

export const errorResponse = json(apiErrorSchema, 'Error with a stable code.')

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional().meta({ description: 'next_cursor from the previous page.' }),
})
