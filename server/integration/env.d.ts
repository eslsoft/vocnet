/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Test-only bindings (see vitest.config.ts). The rest come from worker-configuration.d.ts.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers').D1Migration[]
    OIDC_JWKS: string
    TEST_PRIVATE_JWK: string
  }
}
