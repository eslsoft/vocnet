import type { AppType } from '@server/app'
import { apiErrorSchema } from '@shared/types'
import { hc } from 'hono/client'
import type { z } from 'zod'

let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string): void {
  if (!token) throw new Error('Access Token must not be empty.')
  accessToken = token
}

export function clearAccessToken(): void {
  accessToken = null
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

export class ApiProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ApiProtocolError'
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new ApiProtocolError(`API returned non-JSON content for status ${response.status}.`)
  }
  try {
    return await response.json()
  } catch (cause) {
    throw new ApiProtocolError('API returned malformed JSON.', { cause })
  }
}

async function throwApiError(response: Response): Promise<never> {
  const parsedError = apiErrorSchema.safeParse(await readJson(response))
  if (!parsedError.success) {
    throw new ApiProtocolError(`API error response does not match the contract for status ${response.status}.`)
  }
  if (response.status === 401) clearAccessToken()
  throw new ApiClientError(response.status, parsedError.data.error.code, parsedError.data.error.message)
}

/** Decodes a response and keeps the payload as sent, for views that show the wire JSON beside its reading. */
export async function decodeApiPayload<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<{ data: T; payload: unknown }> {
  if (!response.ok) await throwApiError(response)
  const payload = await readJson(response)
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new ApiProtocolError('API success response does not match the runtime contract.', {
      cause: parsed.error,
    })
  }
  return { data: parsed.data, payload }
}

export async function decodeApiResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  return (await decodeApiPayload(response, schema)).data
}

/** Checks a response that succeeds without a body (204). */
export async function expectNoContent(response: Response): Promise<void> {
  if (!response.ok) await throwApiError(response)
  if (response.status !== 204) throw new ApiProtocolError(`API answered ${response.status} where 204 was expected.`)
}

// Hono RPC supplies compile-time route inference. Runtime payloads are decoded
// separately through decodeApiResponse before they enter a feature.
const authFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers)
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)
  return fetch(input, { ...init, headers })
}

export const rpc = hc<AppType>('/', { fetch: authFetch })
