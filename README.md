# vocnet

A clean-architecture starter for full-stack apps on Cloudflare: **Hono API on
Workers + React SPA (served as static assets) + D1**, with the test and tooling
harness wired up. A single `notes` resource is the worked example of every layer.

## Stack

- Hono on Cloudflare Workers, D1 (drizzle-orm, generated migrations)
- Typed end to end: the SPA calls the API through a **Hono RPC** client (`hc<AppType>`)
- React 19 + react-query + react-router 7 (lazy routes), Vite (`@cloudflare/vite-plugin`)
- Tailwind v4 + shadcn/ui, i18n (i18next), light/dark/system theme
- OIDC auth (`oidc-client-ts` + `jose`), stateless JWT verification
- Biome, dependency-cruiser (architecture enforcement), TypeScript
- Vitest (unit / jsdom+MSW / workerd+D1), Playwright E2E, Gherkin `.feature` specs
- Husky: conventional-commit + lint-staged hooks; CI + CD workflows

## Quick start

```bash
pnpm install
pnpm dev            # vite dev: SPA + Worker + local D1
```

Create the D1 and set its id in `wrangler.toml`:

```bash
wrangler d1 create vocnet   # paste database_id into wrangler.toml
pnpm db:migrate:local                 # apply migrations to the local D1
```

## Project structure

The server follows the dependency rule (`http → usecases → domain`; adapters and
composition wire it together). The SPA has its own enforced layering. Both are
checked by `pnpm lint:arch`.

```
server/
  domain/        pure business rules (no framework, no I/O)
  usecases/      app operations + ports.ts (interfaces for the outside world)
  adapters/      port implementations (repos = the only drizzle; auth verifier)
  http/          routes (chained → AppType), middleware, error mapping
  composition.ts createDeps(env): the only place adapters are constructed
  worker.ts      entry: wires deps, secure headers, serves /api/* + static assets
shared/          the API contract (DTOs) — the only thing both halves import
src/
  app/           providers, router, shell (composition)
  routes/        thin page composition
  features/      product capabilities with public index.ts entries
  shared/        api, config, observability, persistence, query, theme, ui, lib, i18n
```

The SPA talks to the API only through `shared/api/client.ts`. The one compile-time link to
the server is the type-only `AppType` import (Hono RPC); at runtime it's pure HTTP.

## Auth (OIDC)

No custom login backend. The SPA logs in against your OIDC provider
(Authorization Code + PKCE), keeps the Access Token in memory, and sends it as
`Authorization: Bearer`. The API verifies the JWT in middleware (against the
issuer's JWKS; audience = client id) — stateless, no session table.

There is **one set of env vars, on the backend**. The SPA fetches its public
config (issuer + client id) from `GET /api/configz` at startup, so the same bundle
runs in every environment.

- Backend: copy `.dev.vars.example` → `.dev.vars`, set `OIDC_ISSUER` / `OIDC_CLIENT_ID`.
E2E starts its own minimal OIDC provider and uses the same login and JWT verification
path as production. There is no development authentication bypass in application code.

`pnpm e2e` builds and tests a production preview with dynamic ports and isolated
state. It also gates accessibility/focus, browser support, CSP/injection behavior,
route performance budgets, and a reviewed visual baseline.

## Adding a capability

Copy the `notes` slice end to end:

1. `shared/types.ts` — the DTOs.
2. `server/db/schema.ts` — the table; `pnpm db:generate` for the migration.
3. `server/domain/` — pure rules (if any).
4. `server/usecases/ports.ts` + a usecase module — orchestration over a repo port.
5. `server/adapters/repos/` — the drizzle repo.
6. `server/composition.ts` — wire the repo into `createDeps`.
7. `server/http/` — a chained `*Routes` const; mount in `server/app.ts`.
8. `src/features/<name>/` — runtime-decoded API calls, hooks, and feature UI; a page
   in `src/routes/`; tests at the cheapest layer; a `spec/*.feature` scenario.

## Conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org)
  (enforced by the commit-msg hook).
- Pre-commit runs Biome on staged files.

## Deploy

CI (`.github/workflows/ci.yml`) gates every push; CD (`deploy.yml`) ships `main`
to Cloudflare. CD is off by default — enable it with the repo variable
`ENABLE_DEPLOY=true`, the secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`,
and a real `database_id` in `wrangler.toml`. Manual: `pnpm build && pnpm run deploy`.

## Coverage policy

`pnpm test:coverage` (run in CI) enforces per-file thresholds over the layers the
**fast** suites own (`unit` + `web`):

- business logic (`server/domain`, `server/usecases`) — **95%**
- everything else gated (`shared`, `src/features` logic) — **90%**

The edge layers the **workerd `integration`** suite owns (`adapters/repos`,
`composition`, `worker`, http full-flow, the real JWKS verify path) can't be
v8-instrumented, so they're guaranteed by the integration suite passing +
`lint:arch`, not a coverage number. Pure presentational/config glue
(`shared/theme`, `shared/query`, `shared/lib`, `shared/ui`) is excluded.

`pnpm test:behavior` independently gates the behavior inventory: all required
integration behaviors and all critical E2E journeys must have test evidence (100%).

## Scripts

`pnpm verify` · `pnpm test` (unit+web+integration) · `pnpm test:behavior` · `pnpm e2e` · `pnpm lint:arch` ·
`pnpm typecheck` · `pnpm build` · `pnpm db:generate` · `pnpm cf-typegen`
