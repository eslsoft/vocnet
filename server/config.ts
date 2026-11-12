import { z } from 'zod'

// Env is external input: each config is parsed here, once, into a typed shape.
// Plain interfaces (Cloudflare.Env is a structural superset) keep this module,
// and everything that imports it, browser-safe.

function parse<T extends z.ZodType>(schema: T, env: unknown, what: string): z.infer<T> {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(`Invalid ${what} configuration: ${detail}`)
  }
  return parsed.data
}

export interface AuthEnv {
  OIDC_ISSUER: string
  OIDC_CLIENT_ID: string
  OIDC_AUDIENCE: string
  OIDC_JWKS?: string
}

const authConfigSchema = z.object({
  OIDC_ISSUER: z.url(),
  OIDC_CLIENT_ID: z.string().min(1),
  // The `aud` of the console's access tokens: the issuer's UserInfo endpoint, as no
  // resource is requested (the token authenticates the admin; it grants no API scope).
  OIDC_AUDIENCE: z.url(),
  // Optional: inline JWKS (tests use a local key set instead of remote discovery).
  OIDC_JWKS: z.string().optional(),
})

export interface AuthConfig {
  issuer: string
  clientId: string
  audience: string
  jwks?: string
}

export function getAuthConfig(env: AuthEnv): AuthConfig {
  const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_AUDIENCE, OIDC_JWKS } = parse(authConfigSchema, env, 'auth')
  return { issuer: OIDC_ISSUER, clientId: OIDC_CLIENT_ID, audience: OIDC_AUDIENCE, jwks: OIDC_JWKS }
}

export interface AccessEnv {
  ADMIN_SUBJECTS: string
}

const accessConfigSchema = z.object({ ADMIN_SUBJECTS: z.string() })

/** ADMIN_SUBJECTS is a comma-separated list of OIDC subjects. */
export function getAdminSubjects(env: AccessEnv): ReadonlySet<string> {
  const { ADMIN_SUBJECTS } = parse(accessConfigSchema, env, 'access')
  return new Set(
    ADMIN_SUBJECTS.split(',')
      .map((subject) => subject.trim())
      .filter(Boolean),
  )
}

export interface ReviewEnv {
  MODEL_BASE_URL: string
  MODEL_API_KEY: string
  JEV_MODEL: string
  REVIEW_LLM_MODEL: string
  JEV_CONCURRENCY: string
  REVIEW_LLM_CONCURRENCY: string
  DECISIONS_BASE_URL: string
  DECISIONS_MODEL: string
  OPENAI_API_KEY: string
}

const reviewConfigSchema = z.object({
  MODEL_BASE_URL: z.url(),
  MODEL_API_KEY: z.string().min(1),
  JEV_MODEL: z.string().min(1),
  REVIEW_LLM_MODEL: z.string().min(1),
  JEV_CONCURRENCY: z.coerce.number().int().positive(),
  REVIEW_LLM_CONCURRENCY: z.coerce.number().int().positive(),
  DECISIONS_BASE_URL: z.url(),
  DECISIONS_MODEL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
})

export interface ReviewConfig {
  gateway: { baseUrl: string; apiKey: string }
  jevModel: string
  llmModel: string
  /** The most calls each model on the gateway gets at once, across every request; its rate limits count them. */
  concurrency: { jev: number; llm: number }
  /** OpenAI's Decisions API, which the local gateway does not serve. */
  decisions: { baseUrl: string; apiKey: string; model: string }
}

export function getReviewConfig(env: ReviewEnv): ReviewConfig {
  const config = parse(reviewConfigSchema, env, 'review')
  return {
    gateway: { baseUrl: config.MODEL_BASE_URL, apiKey: config.MODEL_API_KEY },
    jevModel: config.JEV_MODEL,
    llmModel: config.REVIEW_LLM_MODEL,
    concurrency: { jev: config.JEV_CONCURRENCY, llm: config.REVIEW_LLM_CONCURRENCY },
    decisions: { baseUrl: config.DECISIONS_BASE_URL, apiKey: config.OPENAI_API_KEY, model: config.DECISIONS_MODEL },
  }
}
