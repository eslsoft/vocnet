import { defineConfig } from 'drizzle-kit'

// schema.ts is the single source of truth; migrations are GENERATED
// (`pnpm db:generate`), never hand-written. The legacy 0001-0010 SQL files predate
// drizzle-kit and stay as applied history; generated migrations use a timestamp
// prefix so they sort after them and never collide.
export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema.ts',
  out: './migrations',
  migrations: { prefix: 'timestamp' },
})
