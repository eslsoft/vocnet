import { InvalidCredentialError } from '@server/usecases/errors'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'
import { createAuthVerifier } from './verifier'

async function verifierAndKey() {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256' }
  return {
    verifier: createAuthVerifier({
      issuer: 'https://issuer.test',
      clientId: 'client',
      jwks: JSON.stringify({ keys: [jwk] }),
    }),
    privateKey,
  }
}

describe('OIDC verifier', () => {
  it('returns verified user claims', async () => {
    const { verifier, privateKey } = await verifierAndKey()
    const token = await new SignJWT({ email: 'user@test', name: 'User' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setIssuer('https://issuer.test')
      .setAudience('client')
      .setSubject('user-1')
      .setExpirationTime('5m')
      .sign(privateKey)

    await expect(verifier.verify(token)).resolves.toEqual({ sub: 'user-1', email: 'user@test', name: 'User' })
  })

  it('classifies invalid credentials explicitly', async () => {
    const { verifier, privateKey } = await verifierAndKey()
    await expect(verifier.verify('not-a-jwt')).rejects.toBeInstanceOf(InvalidCredentialError)

    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setIssuer('https://issuer.test')
      .setAudience('client')
      .setSubject('user-1')
      .setExpirationTime(0)
      .sign(privateKey)
    await expect(verifier.verify(expired)).rejects.toBeInstanceOf(InvalidCredentialError)
  })

  it('does not disguise provider failures as invalid credentials', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }))
    const verifier = createAuthVerifier({ issuer: 'https://unavailable.test', clientId: 'client' })

    await expect(verifier.verify('token')).rejects.toThrow('OIDC discovery failed: 503')
    fetchSpy.mockRestore()
  })
})
