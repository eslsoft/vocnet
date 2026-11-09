import { createAuthVerifier } from '@server/adapters/auth/verifier'
import { createNotesRepo } from '@server/adapters/repos/notes'
import { systemClock, uuidGenerator } from '@server/adapters/system'
import { getAuthConfig } from '@server/config'
import { createDb } from '@server/db/client'
import type { Env } from '@server/env'
import type { Deps } from '@server/usecases/deps'

// The only place adapters are constructed. Per-request; a cheap plain object.
export function createDeps(env: Env): Deps {
  const db = createDb(env)
  return {
    notesRepo: createNotesRepo(db),
    authVerifier: createAuthVerifier(getAuthConfig(env)),
    clock: systemClock,
    idGenerator: uuidGenerator,
  }
}
