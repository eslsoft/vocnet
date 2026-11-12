import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { server } from '@/test/msw'
import {
  ApiClientError,
  ApiProtocolError,
  clearAccessToken,
  decodeApiPayload,
  decodeApiResponse,
  expectNoContent,
  getAccessToken,
  rpc,
  setAccessToken,
} from './client'

describe('rpc client', () => {
  afterEach(clearAccessToken)

  it('attaches the bearer token', async () => {
    setAccessToken('tok')
    let sent: string | null = null
    server.use(
      http.get('/configz', ({ request }) => {
        sent = request.headers.get('authorization')
        return HttpResponse.json({ oidc: { issuer: 'i', client_id: 'c' } })
      }),
    )

    await rpc.configz.$get()
    expect(sent).toBe('Bearer tok')
  })

  it('decodes a successful response at runtime', async () => {
    const response = new Response(JSON.stringify({ value: 'ok' }), {
      headers: { 'content-type': 'application/json' },
    })
    await expect(decodeApiResponse(response, z.object({ value: z.literal('ok') }))).resolves.toEqual({ value: 'ok' })
  })

  it('keeps the payload as sent beside its decoded reading', async () => {
    const response = new Response(JSON.stringify({ value: 'ok', extra: 1 }), {
      headers: { 'content-type': 'application/json' },
    })
    await expect(decodeApiPayload(response, z.object({ value: z.literal('ok') }))).resolves.toEqual({
      data: { value: 'ok' },
      payload: { value: 'ok', extra: 1 },
    })
  })

  it('surfaces stable API errors and clears credentials on 401', async () => {
    setAccessToken('tok')
    const response = new Response(
      JSON.stringify({ error: { code: 'invalid_credential', message: 'Invalid credential.' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )

    const error = await decodeApiResponse(response, z.object({})).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(ApiClientError)
    expect(error).toMatchObject({ status: 401, code: 'invalid_credential' })
    expect(getAccessToken()).toBeNull()
  })

  it('rejects malformed success and error payloads', async () => {
    const invalidSuccess = new Response(JSON.stringify({ value: 1 }), {
      headers: { 'content-type': 'application/json' },
    })
    await expect(decodeApiResponse(invalidSuccess, z.object({ value: z.string() }))).rejects.toBeInstanceOf(
      ApiProtocolError,
    )

    const invalidError = new Response(JSON.stringify({ message: 'no stable code' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
    await expect(decodeApiResponse(invalidError, z.object({}))).rejects.toBeInstanceOf(ApiProtocolError)
  })

  it('rejects empty tokens, non-JSON responses, and malformed JSON', async () => {
    expect(() => setAccessToken('')).toThrow('must not be empty')
    await expect(decodeApiResponse(new Response('text'), z.string())).rejects.toBeInstanceOf(ApiProtocolError)
    await expect(
      decodeApiResponse(new Response('{', { headers: { 'content-type': 'application/json' } }), z.object({})),
    ).rejects.toBeInstanceOf(ApiProtocolError)
  })

  it('accepts a 204 without a body and surfaces errors where one was expected', async () => {
    await expect(expectNoContent(new Response(null, { status: 204 }))).resolves.toBeUndefined()
    await expect(
      expectNoContent(new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } })),
    ).rejects.toBeInstanceOf(ApiProtocolError)
    const forbidden = new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Curators only.' } }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })
    await expect(expectNoContent(forbidden)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })
})
