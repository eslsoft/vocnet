import type { AuthConfig } from '@server/config'
import { InvalidCredentialError } from '@server/usecases/errors'
import type { AuthUser, AuthVerifier } from '@server/usecases/ports'
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  errors,
  type JWTPayload,
  jwtVerify,
} from 'jose'
import { z } from 'zod'

type JwksResolver = Parameters<typeof jwtVerify>[1]

// Remote JWKS sets are cached per issuer for the lifetime of the isolate.
const remoteCache = new Map<string, JwksResolver>()

function toUser(payload: JWTPayload): AuthUser {
  if (!payload.sub) throw new InvalidCredentialError('Credential has no subject.')
  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    name: typeof payload.name === 'string' ? payload.name : null,
  }
}

async function resolveJwks(config: AuthConfig): Promise<JwksResolver> {
  if (config.jwks) return createLocalJWKSet(JSON.parse(config.jwks))

  const cached = remoteCache.get(config.issuer)
  if (cached) return cached

  const discoveryUrl = new URL('.well-known/openid-configuration', `${config.issuer.replace(/\/$/, '')}/`)
  const response = await fetch(discoveryUrl)
  if (!response.ok) throw new Error(`OIDC discovery failed: ${response.status}`)
  const { jwks_uri } = z.object({ jwks_uri: z.url() }).parse(await response.json())
  const resolver = createRemoteJWKSet(new URL(jwks_uri))
  remoteCache.set(config.issuer, resolver)
  return resolver
}

/** A token that is not a JWT is a bad credential whatever the issuer's state, so it never waits on discovery. */
function assertJwtShape(token: string): void {
  try {
    decodeJwt(token)
    decodeProtectedHeader(token)
  } catch (error) {
    // decodeJwt throws JWTInvalid and decodeProtectedHeader a TypeError for malformed input.
    if (error instanceof errors.JWTInvalid || error instanceof TypeError) throw new InvalidCredentialError()
    throw error
  }
}

export function createAuthVerifier(config: AuthConfig): AuthVerifier {
  return {
    async verify(token) {
      assertJwtShape(token)
      const jwks = await resolveJwks(config)
      try {
        const { payload } = await jwtVerify(token, jwks, { issuer: config.issuer, audience: config.clientId })
        return toUser(payload)
      } catch (error) {
        if (
          error instanceof errors.JWTClaimValidationFailed ||
          error instanceof errors.JWTExpired ||
          error instanceof errors.JWSInvalid ||
          error instanceof errors.JWTInvalid ||
          error instanceof errors.JWSSignatureVerificationFailed ||
          error instanceof errors.JWKSNoMatchingKey ||
          error instanceof errors.JOSEAlgNotAllowed
        ) {
          throw new InvalidCredentialError()
        }
        throw error
      }
    },
  }
}
