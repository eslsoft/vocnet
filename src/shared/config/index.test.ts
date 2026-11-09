import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '@/test/msw'
import { getConfig, loadConfig } from './index'

describe('runtime config', () => {
  it('throws before load, then returns the fetched config', async () => {
    expect(() => getConfig()).toThrow('not loaded')

    server.use(
      http.get('/api/configz', () => HttpResponse.json({ oidc: { issuer: 'https://issuer.test', clientId: 'c' } })),
    )
    const config = await loadConfig()

    expect(config.oidc.clientId).toBe('c')
    expect(getConfig()).toEqual(config)
  })

  it('throws when the request fails', async () => {
    server.use(
      http.get('/api/configz', () =>
        HttpResponse.json({ error: { code: 'internal_error', message: 'Internal server error.' } }, { status: 500 }),
      ),
    )
    await expect(loadConfig()).rejects.toThrow('Internal server error')
  })
})
