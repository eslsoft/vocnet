import { z } from 'zod'

// The shape getAuthConfig reads. A plain interface (Cloudflare.Env is a structural
// superset) so this module — and everything that imports it — stays browser-safe.
export interface AuthEnv {
  OIDC_ISSUER: string
  OIDC_CLIENT_ID: string
  OIDC_JWKS?: string
}

// Runtime validation of auth env. Throws a clear error if misconfigured, instead
// of failing deep inside token verification.
const authConfigSchema = z.object({
  OIDC_ISSUER: z.string().url(),
  OIDC_CLIENT_ID: z.string().min(1),
  // Optional: inline JWKS (tests use a local key set instead of remote discovery).
  OIDC_JWKS: z.string().optional(),
})

export interface AuthConfig {
  issuer: string
  clientId: string
  jwks?: string
}

export function getAuthConfig(env: AuthEnv): AuthConfig {
  const parsed = authConfigSchema.safeParse(env)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(`Invalid auth configuration: ${detail}`)
  }
  const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_JWKS } = parsed.data
  return { issuer: OIDC_ISSUER, clientId: OIDC_CLIENT_ID, jwks: OIDC_JWKS }
}
