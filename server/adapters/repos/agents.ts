import { type AgentRow, agents } from '@server/db/schema'
import type { PrincipalRef } from '@server/domain/principal'
import type { AgentRecord, AgentRepo } from '@server/usecases/ports'
import type { AgentId } from '@shared/agents'
import { asc, eq } from 'drizzle-orm'
import type { Db } from './rows'

const toAgent = (row: AgentRow): AgentRecord => ({
  id: row.id as AgentId,
  name: row.name,
  createdBy: row.createdBy as PrincipalRef,
  createdAt: row.createdAt,
  revokedAt: row.revokedAt,
})

export function createAgentRepo(db: Db): AgentRepo {
  return {
    async insert(agent, keyHash) {
      await db.insert(agents).values({ ...agent, keyHash })
    },
    async find(id) {
      const row = await db.select().from(agents).where(eq(agents.id, id)).get()
      return row ? toAgent(row) : null
    },
    async findByKeyHash(keyHash) {
      const row = await db.select().from(agents).where(eq(agents.keyHash, keyHash)).get()
      return row ? toAgent(row) : null
    },
    async list() {
      return (await db.select().from(agents).orderBy(asc(agents.createdAt), asc(agents.id))).map(toAgent)
    },
    async revoke(id, at) {
      await db.update(agents).set({ revokedAt: at }).where(eq(agents.id, id))
    },
  }
}
