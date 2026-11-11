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
      audience: AUDIENCE,
      jwks: JSON.stringify({ keys: [jwk] }),
    }),
    privateKey,
  }
}

const AUDIENCE = 'https://issuer.test/oauth2/userinfo'

/** An access token as the issuer signs one for the console, with any claim overridden. */
function accessToken(privateKey: CryptoKey, claims: Record<string, unknown> = {}, typ = 'at+jwt') {
  const exp = Math.floor(Date.now() / 1000) + 300
  const payload = { iss: 'https://issuer.test', aud: AUDIENCE, sub: 'user-1', exp, client_id: 'client', ...claims }
  return new SignJWT(payload).setProtectedHeader({ alg: 'ES256', kid: 'test', typ }).sign(privateKey)
}

describe('OIDC verifier', () => {
  it('returns verified user claims', async () => {
    const { verifier, privateKey } = await verifierAndKey()
    const token = await accessToken(privateKey, { email: 'user@test', name: 'User' })
    await expect(verifier.verify(token)).resolves.toEqual({ sub: 'user-1', email: 'user@test', name: 'User' })
  })

  it('refuses a token of another client, an ID token, and another audience [spec: access/console-token]', async () => {
    const { verifier, privateKey } = await verifierAndKey()
    await expect(verifier.verify(await accessToken(privateKey, { client_id: 'other-app' }))).rejects.toBeInstanceOf(
      InvalidCredentialError,
    )
    await expect(verifier.verify(await accessToken(privateKey, {}, 'JWT'))).rejects.toBeInstanceOf(
      InvalidCredentialError,
    )
    await expect(verifier.verify(await accessToken(privateKey, { aud: 'client' }))).rejects.toBeInstanceOf(
      InvalidCredentialError,
    )
  })

  it('classifies invalid credentials explicitly', async () => {
    const { verifier, privateKey } = await verifierAndKey()
    await expect(verifier.verify('not-a-jwt')).rejects.toBeInstanceOf(InvalidCredentialError)

    const expired = await accessToken(privateKey, { exp: 0 })
    await expect(verifier.verify(expired)).rejects.toBeInstanceOf(InvalidCredentialError)
  })

  it('rejects a token that is not a JWT before contacting an unreachable issuer [spec: access/malformed-token]', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }))
    const verifier = createAuthVerifier({ issuer: 'https://unavailable.test', clientId: 'client', audience: AUDIENCE })

    const malformed = ['garbage', 'a.b.c', `${btoa('{"alg":"ES256"}')}.${btoa('[]')}.sig`, `x.${btoa('{}')}.sig`]
    for (const token of malformed) {
      await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidCredentialError)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('does not disguise provider failures as invalid credentials', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }))
    const verifier = createAuthVerifier({ issuer: 'https://unavailable.test', clientId: 'client', audience: AUDIENCE })
    const { privateKey } = await generateKeyPair('ES256')
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setSubject('user-1')
      .sign(privateKey)

    await expect(verifier.verify(token)).rejects.toThrow('OIDC discovery failed: 503')
    fetchSpy.mockRestore()
  })
})
