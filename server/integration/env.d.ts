/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Test-only bindings (see vitest.config.ts). DB / ASSETS / OIDC_* come from
// worker-configuration.d.ts; these are added for the integration suite.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers').D1Migration[]
    OIDC_JWKS: string
    TEST_PRIVATE_JWK: string
  }
}
