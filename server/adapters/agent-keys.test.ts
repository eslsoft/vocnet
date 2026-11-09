import { describe, expect, it } from 'vitest'
import { webCryptoAgentKeys } from './agent-keys'

describe('agent key crypto', () => {
  it('makes unguessable url-safe secrets and hashes them with SHA-256', async () => {
    const secret = webCryptoAgentKeys.randomSecret()
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(webCryptoAgentKeys.randomSecret()).not.toBe(secret)
    await expect(webCryptoAgentKeys.hash('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
