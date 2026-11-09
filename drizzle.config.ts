import { defineConfig } from 'drizzle-kit'

// schema.ts is the single source of truth; migrations are GENERATED
// (`pnpm db:generate`), never hand-written.
export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema.ts',
  out: './migrations',
  migrations: { prefix: 'timestamp' },
})
