import type { Clock, IdGenerator } from '@server/usecases/ports'

export const systemClock: Clock = { now: () => new Date() }
export const uuidGenerator: IdGenerator = { next: () => crypto.randomUUID() }
