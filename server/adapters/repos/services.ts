import { type ServiceRow, services } from '@server/db/schema'
import type { PrincipalRef } from '@server/domain/principal'
import type { ServiceRecord, ServiceRepo } from '@server/usecases/ports'
import type { ServiceId } from '@shared/services'
import { asc, eq } from 'drizzle-orm'
import type { Db } from './rows'

const toService = (row: ServiceRow): ServiceRecord => ({
  id: row.id as ServiceId,
  name: row.name,
  createdBy: row.createdBy as PrincipalRef,
  createdAt: row.createdAt,
  revokedAt: row.revokedAt,
})

export function createServiceRepo(db: Db): ServiceRepo {
  return {
    async insert(service, keyHash) {
      await db.insert(services).values({ ...service, keyHash })
    },
    async find(id) {
      const row = await db.select().from(services).where(eq(services.id, id)).get()
      return row ? toService(row) : null
    },
    async findByKeyHash(keyHash) {
      const row = await db.select().from(services).where(eq(services.keyHash, keyHash)).get()
      return row ? toService(row) : null
    },
    async list() {
      return (await db.select().from(services).orderBy(asc(services.createdAt), asc(services.id))).map(toService)
    },
    async revoke(id, at) {
      await db.update(services).set({ revokedAt: at }).where(eq(services.id, id))
    },
  }
}
