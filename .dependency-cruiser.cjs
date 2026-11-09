/**
 * Executable architecture boundaries for this starter.
 *
 *   pnpm add -D dependency-cruiser
 *   package.json: "lint:arch": "depcruise server/ shared/ src/ --config .dependency-cruiser.cjs"
 *   (keep the trailing slashes — bare directory names can resolve to 0 modules)
 *
 * tsConfig points at the architecture-wide config so resolution covers both halves.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },

    // ---- server: the dependency rule ----
    {
      name: 'domain-stays-pure',
      comment: 'domain/ may only import domain/ and shared/. No frameworks, no I/O.',
      severity: 'error',
      from: { path: '^server/domain' },
      to: { pathNot: '^server/domain|^shared' },
    },
    {
      name: 'usecases-no-infrastructure',
      comment: 'usecases/ must not reach outward to adapters, http, db, or composition.',
      severity: 'error',
      from: { path: '^server/usecases' },
      to: { path: '^server/(adapters|http|db)|^server/composition' },
    },
    {
      name: 'usecases-no-framework-packages',
      comment: 'usecases/ must not import delivery or persistence frameworks.',
      severity: 'error',
      from: { path: '^server/usecases' },
      to: { path: 'node_modules/(hono|drizzle-orm|zod)' },
    },
    {
      name: 'adapters-not-into-delivery',
      comment: 'adapters/ implement ports; they never know about http/ or composition.',
      severity: 'error',
      from: { path: '^server/adapters' },
      to: { path: '^server/(http|composition)' },
    },
    {
      name: 'drizzle-only-in-repos',
      // When the project uses better-auth (or similar: owns its own tables AND is
      // consumed directly by the delivery layer), keep it at server/auth.ts and
      // extend pathNot with `|^server/auth` as a named exception.
      comment: 'Persistence is confined to adapters/repos/ and db/.',
      severity: 'error',
      from: { path: '^server', pathNot: '^server/(adapters/repos|db)' },
      to: { path: 'node_modules/drizzle-orm|^server/db/schema' },
    },
    {
      name: 'http-not-into-adapters',
      comment: 'http/ gets dependencies from context, never constructs adapters.',
      severity: 'error',
      from: { path: '^server/http' },
      to: { path: '^server/adapters' },
    },

    // ---- the two halves meet only through shared/ ----
    {
      name: 'shared-is-a-leaf',
      comment: 'shared/ is the contract; it imports nothing from server/ or src/.',
      severity: 'error',
      from: { path: '^shared' },
      to: { path: '^server|^src' },
    },
    {
      name: 'frontend-not-into-server',
      comment: 'Only the transport adapter may import the Hono AppType, and only as a type.',
      severity: 'error',
      from: { path: '^src', pathNot: '^src/shared/api/client\.ts$' },
      to: { path: '^server' },
    },
    {
      name: 'transport-server-import-is-type-only',
      severity: 'error',
      from: { path: '^src/shared/api/client\.ts$' },
      to: { path: '^server', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'server-not-into-frontend',
      comment: 'The server never reaches into the SPA; the two halves meet only through shared/.',
      severity: 'error',
      from: { path: '^server' },
      to: { path: '^src' },
    },

    // ---- frontend: keep the SPA from turning into a ball of mud ----
    {
      name: 'frontend-shared-is-a-leaf',
      comment: 'src/shared contains stack infrastructure and primitives; it never reaches into product code.',
      severity: 'error',
      from: { path: '^src/shared' },
      to: { path: '^src/(features|routes|app)' },
    },
    {
      name: 'frontend-features-do-not-compose-pages',
      comment: 'Features own capabilities; app and route composition point toward them.',
      severity: 'error',
      from: { path: '^src/features' },
      to: { path: '^src/(routes|app)' },
    },
    {
      name: 'cross-feature-imports-use-public-entry',
      comment: 'A feature may depend on another feature only through its public index.',
      severity: 'error',
      from: { path: '^src/features/([^/]+)/' },
      to: {
        path: '^src/features/',
        pathNot: ['^src/features/$1/', '^src/features/[^/]+/index\.tsx?$'],
      },
    },
    {
      name: 'composition-imports-feature-public-entry',
      comment: 'App and routes consume feature public APIs, not feature internals.',
      severity: 'error',
      from: { path: '^src/(app|routes)' },
      to: { path: '^src/features/[^/]+/', pathNot: '^src/features/[^/]+/index\.tsx?$' },
    },
    {
      name: 'frontend-routes-are-leaves',
      comment: 'Route pages are mounted by app/router; features, components, and lib never import them.',
      severity: 'error',
      from: { path: '^src/(features|shared)' },
      to: { path: '^src/routes' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Tests are exempt; so is generated code (openapi-ts clients etc.).
    exclude: { path: ['\\.(test|spec)\\.[jt]sx?$', '\\.gen\\.[jt]s$'] },
    tsConfig: { fileName: 'tsconfig.arch.json' },
    tsPreCompilationDeps: true,
  },
}
