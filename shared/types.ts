import { z } from 'zod'

export const apiErrorCodeSchema = z.enum([
  'authentication_required',
  'invalid_credential',
  'forbidden',
  'invalid_request',
  'invalid_cursor',
  'invalid_reference',
  'not_found',
  'conflict',
  'rate_limited',
  'internal_error',
])
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>

export const apiErrorSchema = z
  .object({ error: z.object({ code: apiErrorCodeSchema, message: z.string().min(1) }) })
  .meta({ id: 'Error' })
export type ApiErrorPayload = z.infer<typeof apiErrorSchema>

// Public runtime config the SPA fetches from GET /configz. The backend env is the
// single source of truth; only PUBLIC values may be exposed here.
export const clientConfigSchema = z.object({
  oidc: z.object({
    issuer: z.url(),
    client_id: z.string().min(1),
  }),
})
export type ClientConfig = z.infer<typeof clientConfigSchema>
