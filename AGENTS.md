# Engineering instructions

Vocnet is a relational English dictionary maintained by external agents. The
contract is `docs/design.md`; change it in the same commit as any behavior it
describes.

Use `$best-engineering-practice` for every code change. This repository is the
Hono + Cloudflare Workers + React specialization of that technology-neutral
policy. When rules conflict, the generic skill's core policy wins.

## Domain rules

- Facts are the unit. Every reviewed claim is one row in `facts`; nodes
  (`entries`, `senses`) carry identity only. Never review, publish, or gate a
  fact on another fact being ready; visibility is derived on read.
- `server/domain/fact-kinds.ts` is the single source for kinds: subject type,
  cardinality, reviewer, content key, and review plan. Add a kind there plus its
  payload schema in `shared/facts.ts`. Never branch on a kind name elsewhere.
- Status changes go through the transition table in
  `server/domain/fact-lifecycle.ts` and are written conditionally on the
  `from` statuses. Writes converge: submissions dedupe by content key, review is
  a no-op unless pending, the cron re-enqueues stuck facts.
- Lookups have no fallbacks. A lemma, form, or id that does not match exactly
  is 404; never retry with a lowercased, stemmed, or fuzzy variant.
- A reviewer transport failure is not a verdict. It propagates so the queue
  retries; it never rejects a fact.
- Authorize and scope with the principal: record it as author, creator, or
  assignee, and let agents act only on what they own.

## Required workflow

1. Read the relevant behavior in `spec/` and update it when behavior changes.
2. Keep the change within the boundaries below. Do not add compatibility or
   fallback branches for unpublished code; migrate persisted data instead.
3. Test the changed implementation at the cheapest meaningful layer and add the
   required `[spec: <id>]` evidence derived from the tags in `spec/*.feature`.
4. Run `pnpm verify`. Run `pnpm e2e` when a critical browser journey changes.

Do not weaken a gate, exclude production logic from coverage, or turn an error
into a default to make verification pass.

## Backend boundaries

- `server/domain/`: pure business rules; no framework or I/O.
- `server/usecases/`: application operations and the ports they consume. Accept
  only the dependencies an operation needs.
- `server/adapters/`: implementations of persistence, identity, external APIs,
  clocks, and ID generation.
- `server/http/`: `@hono/zod-openapi` route definitions (validation and the
  OpenAPI documents come from the same schemas), auth, transport mapping, and
  boundary observability. Routes invoke use cases; they do not query
  repositories directly. The public wire is snake_case JSON.
- `server/composition.ts`: the manual TypeScript composition root. Do not add a DI
  framework unless the ecosystem and application complexity make it worthwhile.
- `shared/`: authoritative runtime wire schemas and inferred DTO types.

Expected failures have stable error codes and are returned explicitly.
Unexpected failures propagate to the unified HTTP error/access-log boundary with
their stack and context; never disguise provider, network, or programming failures
as invalid user credentials. Log request metadata at the boundary without bodies.
Mutation audit events belong in the audit middleware; add business audit points
only for events that cannot be derived from resource operations.
Carry request/trace IDs into async payloads and log them at the async entry boundary.

Admins authenticate with OIDC Authorization Code + PKCE and must be listed in
`ADMIN_SUBJECTS`; agents use `vn_agent_` API keys stored only as SHA-256
hashes. The console uses the Access Token, keeps it in memory, and sends it as
Bearer. Never substitute the ID Token, persist
tokens in browser storage, or add a production authentication bypass for tests.

## Frontend boundaries

- `src/app/`: application composition, providers, router, and shell.
- `src/routes/`: thin page composition.
- `src/features/<name>/`: one product capability. Export its public surface from
  `index.ts`; consumers never import feature internals.
- `src/shared/api|config|observability|persistence|query|theme`: stack
  infrastructure with explicit browser/external boundaries.
- `src/shared/ui|lib|i18n`: reusable leaf primitives with no product knowledge.

Decode all network and persisted payloads at runtime. Persist only versioned,
non-sensitive state. Surface operation errors in the UI where the user acted;
report unexpected browser failures through the centralized browser boundary.
Primary pages are for browsing and operating resources. Put create/edit/config
forms in a modal, drawer, or secondary page.

## Test ownership and gates

- Unit: domain/use-case/pure logic with explicit fakes; per-file coverage is at
  least 90% (95% for business logic in this starter).
- Component: render behavior with Testing Library; mock HTTP at the MSW boundary,
  not internal hooks or implementation modules.
- Integration: run the real Worker, migrations, D1, JWT verification, routing,
  and serialization in workerd.
- E2E: only critical cross-stack journeys. `pnpm e2e` creates unique temporary
  state and dynamic app/OIDC ports, never reuses the developer environment, uses
  zero retries, retains failure evidence, and removes runtime state afterward.

The E2E gate runs the production preview across `quality/browser-support.json`
and independently checks accessibility/focus, CSP and injection resistance,
owned performance budgets, and reviewed visual baselines.

`spec/*.feature` generates the measurable BDD/integration/E2E coverage inventory.
Traceability, integration behavior coverage, and critical E2E coverage must remain 100%.

## Commands

- `pnpm verify`: formatting/lint, architecture, types, behavior inventory, tests,
  coverage, and production build.
- `pnpm test`: unit + component + workerd integration tests.
- `pnpm test:coverage`: per-file unit/component code coverage.
- `pnpm test:behavior`: behavior-layer and critical-path coverage.
- `pnpm e2e`: hermetic full-stack Playwright suite.
- `pnpm db:generate`: generate migrations after editing the schema.

Commits follow Conventional Commits. Delete dead code instead of preserving
obsolete paths.
