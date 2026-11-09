import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import react from '@vitejs/plugin-react-swc'
import { exportJWK, generateKeyPair } from 'jose'
import { defineConfig } from 'vitest/config'

const alias = {
  '@': path.resolve(__dirname, './src'),
  '@server': path.resolve(__dirname, './server'),
  '@shared': path.resolve(__dirname, './shared'),
}

// A throwaway keypair so the integration suite exercises the REAL JWT verification
// path: the worker verifies against the public JWKS, the test signs with the private key.
async function testAuthBindings() {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
  const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'ES256' }
  const privateJwk = { ...(await exportJWK(privateKey)), kid: 'test', alg: 'ES256' }
  return {
    OIDC_ISSUER: 'https://issuer.test',
    OIDC_CLIENT_ID: 'test-client',
    OIDC_JWKS: JSON.stringify({ keys: [publicJwk] }),
    TEST_PRIVATE_JWK: JSON.stringify(privateJwk),
  }
}

export default defineConfig({
  test: {
    // Coverage gates the layers the FAST suites own (node `unit` + jsdom `web`); the
    // workerd `integration` pool can't be v8-instrumented, so the edge layers it owns
    // (adapters/repos, composition, worker, http full-flow, the real JWKS verify path)
    // are proven by the integration suite + `lint:arch`, not a coverage %. See README.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: [
        // business logic
        'server/domain/**',
        'server/usecases/**',
        // pure contract + helpers
        'shared/**',
        // frontend logic (covered by the `web` project)
        'src/features/**',
        'src/shared/api/**',
        'src/shared/config/**',
        'src/shared/observability/**',
        'src/shared/persistence/**',
      ],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/index.ts', // barrels: re-exports only
        'src/shared/i18n/**',
        'src/shared/lib/**',
        'src/shared/query/**',
        'src/shared/theme/**',
        'src/shared/ui/**',
        // Presentational / config glue — exercised by the web component tests + e2e,
        // not worth unit-gating (same spirit as "don't test the ui/ primitives").
      ],
      thresholds: {
        perFile: true,
        // Default floor for everything in `include`.
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
        // Business logic: stricter.
        'server/domain/**': { statements: 95, branches: 95, functions: 95, lines: 95 },
        'server/usecases/**': { statements: 95, branches: 95, functions: 95, lines: 95 },
      },
    },
    projects: [
      // Server fast suite: pure domain rules, usecases over fake ports, adapters
      // over stubbed fetch, http wiring. Runs in node.
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['server/**/*.test.ts', 'shared/**/*.test.ts'],
          exclude: ['server/integration/**'],
        },
        resolve: { alias },
      },
      // Frontend suite: pure lib helpers, the api client, and component/hook tests
      // with the API mocked at the network boundary (MSW). Runs in jsdom.
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/test/setup.ts'],
        },
        resolve: { alias },
      },
      // Integration suite: full request flows through app.fetch inside workerd, with a real
      // D1 binding and the production migrations applied.
      {
        plugins: [
          cloudflareTest(async () => ({
            singleWorker: true,
            miniflare: {
              compatibilityDate: '2026-06-03',
              compatibilityFlags: ['nodejs_compat'],
              d1Databases: ['DB'],
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations(path.join(__dirname, 'migrations')),
                ...(await testAuthBindings()),
              },
            },
          })),
        ],
        test: {
          name: 'integration',
          include: ['server/integration/**/*.test.ts'],
          setupFiles: ['./server/integration/apply-migrations.ts'],
        },
        resolve: { alias },
      },
    ],
  },
})
