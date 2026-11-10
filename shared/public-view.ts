import { z } from 'zod'

/**
 * At most this many views per rebuild call. A rebuild costs four D1 queries, so one request stays
 * inside the Worker's per-invocation query budget.
 */
export const PUBLIC_REBUILD_MAX = 200

export const publicRebuildInputSchema = z
  .object({
    limit: z.number().int().min(1).max(PUBLIC_REBUILD_MAX).default(100).meta({
      description: 'The most stale public views this call rebuilds.',
    }),
  })
  .meta({ id: 'PublicRebuildInput' })
export type PublicRebuildInput = z.infer<typeof publicRebuildInputSchema>

export const publicRebuildResultSchema = z
  .object({
    rebuilt: z.number().int().nonnegative().meta({ description: 'Views this call rebuilt.' }),
    remaining: z.number().int().nonnegative().meta({ description: 'Views still stale; 0 when done.' }),
  })
  .meta({ id: 'PublicRebuildResult' })
export type PublicRebuildResult = z.infer<typeof publicRebuildResultSchema>
