# vocnet

Vocnet is a relational English dictionary that agents outside the system
maintain continuously. The data is the product. Every item (a lemma, a gloss, a
form, a relation between two senses, a pronunciation, an example, a
translation) is one **fact**. Each fact is reviewed on its own, by Jev when it
states a checkable proposition and by a general LLM otherwise, and published on
its own with its confidence. Facts can be published with flaws and corrected
later.

The contract is [docs/design.md](docs/design.md).

## Surfaces

| Path                         | Who               | What                                                   |
| ---------------------------- | ----------------- | ------------------------------------------------------ |
| `GET /v1/entries`            | Everyone          | Published entries by prefix, paged with `next_cursor`  |
| `GET /v1/entries/{lemma}`    | Everyone          | One entry with its published facts                     |
| `GET /v1/forms/{form}`       | Everyone          | Entries that own an exact published form (no fallback) |
| `GET /v1/senses/{id}`        | Everyone          | One sense with its entry                               |
| `POST /v1/feedback`          | Everyone          | Report a problem with an entry, sense, or fact         |
| `GET /openapi.json`, `/docs` | Everyone          | Public OpenAPI 3.1 document and its Scalar reference   |
| `/manage/v1/*`               | Agents and admins | Submit entries, senses, facts; review state; feedback  |
| `POST /manage/v1/work/claim` | Agents and admins | Lease the next entry to work on, with its gaps         |
| `POST /manage/v1/work/{lease_id}/complete` | Agents and admins | Finish work on a leased entry            |
| `GET /manage/openapi.json`   | Agents and admins | The management OpenAPI document                        |
| `/manage/v1/agents`          | Admins            | Issue, list, and revoke agent keys                     |

Agents authenticate with `Authorization: Bearer vn_agent_…`. Admins use an OIDC
access token whose subject is listed in `ADMIN_SUBJECTS`. The OpenAPI documents
are generated from the same zod route definitions that validate requests.

## Stack

- Hono on Cloudflare Workers with `@hono/zod-openapi`; D1 through drizzle
  (generated migrations); a Queue for reviews; a cron reconciler.
- React 19 admin console (served as static assets): overview counts, a fact
  browser with review details, an entry inspector, read-only feedback, and agent
  keys. Typed against the API through the Hono RPC client.
- Biome, dependency-cruiser, TypeScript, Vitest (unit, jsdom, workerd with real
  D1), Playwright, Gherkin specs in `spec/`.

## Develop

```bash
pnpm install
cp .dev.vars.example .dev.vars   # fill in the values below
pnpm db:migrate:local            # apply migrations to the local D1
pnpm dev                         # vite dev: console + Worker + local D1 + queue
```

To sign in to the console locally without a real IdP, run the dev-only OIDC
provider (the one the E2E suite uses) in another terminal and point `.dev.vars`
at the values it prints. It signs every login in as one fixed subject, so never
point a deployed Worker at it:

```bash
pnpm dev:oidc   # OIDC_ISSUER=http://127.0.0.1:8788, OIDC_CLIENT_ID=vocnet-dev, ADMIN_SUBJECTS=dev-admin
```

Once signed in, the Agents page issues agent keys. To call the management API
without the console at all, insert an agent row whose
`key_hash` is the SHA-256 hex of a key you choose:

```bash
KEY=vn_agent_localdevkey0001
HASH=$(printf %s "$KEY" | shasum -a 256 | cut -d' ' -f1)
pnpm exec wrangler d1 execute vocnet --local --command \
  "INSERT INTO agents (id,name,key_hash,created_by,created_at) VALUES ('11111111-1111-4111-8111-111111111111','local','$HASH','admin:local','2026-01-01T00:00:00.000Z')"
curl -H "Authorization: Bearer $KEY" localhost:5173/manage/v1/stats
```

## Configuration

One env set, on the Worker. `wrangler.toml` holds bindings and `JEV_MODEL`
(default `jev-latest`); `.dev.vars.example` names the rest:

| Name               | Meaning                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `OIDC_ISSUER`      | OIDC issuer; the Worker verifies admin JWTs against its JWKS            |
| `OIDC_CLIENT_ID`   | Expected audience, also given to the console by `GET /configz`          |
| `ADMIN_SUBJECTS`   | Comma-separated OIDC subjects allowed on the management API             |
| `MODEL_BASE_URL`   | Gateway for Jev (`/v1/systemone`) and the LLM (`/v1/chat/completions`)  |
| `MODEL_API_KEY`    | Bearer key for that gateway (a secret)                                  |
| `JEV_MODEL`        | Jev model name                                                          |
| `REVIEW_LLM_MODEL` | Chat model that reviews pronunciations, examples, and translations      |

Bindings: `DB` (D1 `vocnet`), `REVIEW_QUEUE` (queue `vocnet-reviews`, dead
letters to `vocnet-reviews-dlq`), `ASSETS`, and a `*/5 * * * *` cron.

## Deploy

Create the resources once, then put the D1 id in `wrangler.toml`:

```bash
wrangler d1 create vocnet
wrangler queues create vocnet-reviews
wrangler queues create vocnet-reviews-dlq
wrangler secret put MODEL_API_KEY
pnpm db:migrate:remote
pnpm build && pnpm run deploy
```

CI (`.github/workflows/ci.yml`) gates every push. CD (`deploy.yml`) ships `main`
when the repo variable `ENABLE_DEPLOY=true` and the Cloudflare secrets are set.

## Project structure

```
server/
  domain/        facts, the fact-kind registry, lifecycle, feedback and work leases, gaps, read model
  usecases/      operations over ports (ports.ts, deps.ts)
  adapters/      drizzle repos, Jev and LLM reviewers, queue, agent-key crypto, OIDC
  http/          OpenAPI routes (public + manage/), auth, error mapping
  composition.ts createDeps(env): the only place adapters are constructed
  worker.ts      fetch, queue, and scheduled entries
shared/          wire schemas and DTOs (snake_case), imported by both halves
src/             the admin console shell
spec/            one .feature per capability; tests carry [spec: id]
```

## Verification

`pnpm verify` runs lint, architecture rules, types, the behavior inventory,
unit + web + workerd integration tests, per-file coverage (95% for domain and
use cases, 90% elsewhere), and the production build. `pnpm e2e` runs the
hermetic browser suite. Commits follow Conventional Commits.
