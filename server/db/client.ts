import { timedD1 } from '@server/adapters/d1-timing'
import { drizzle } from 'drizzle-orm/d1'
import type { Env } from '../env'
import * as schema from './schema'

export function createDb(env: Env) {
  return drizzle(timedD1(env.DB), { schema })
}
