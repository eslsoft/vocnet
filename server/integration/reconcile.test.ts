import { env } from 'cloudflare:test'
import { createDeps } from '@server/composition'
import { describe, expect, it } from 'vitest'

const insertFact = (id: string, status: string, updatedAt: string, revalidateSince: string | null) =>
  env.DB.prepare(
    `insert into facts (id, kind, subject_id, object_id, content_key, payload, status, exclusive, author, revalidate_since, created_at, updated_at)
     values (?, 'example', ?, null, ?, ?, ?, 0, 'agent:test', ?, ?, ?)`,
  )
    .bind(id, crypto.randomUUID(), id, JSON.stringify({ text: id }), status, revalidateSince, updatedAt, updatedAt)
    .run()

describe('reconcile', () => {
  it('takes stuck pending facts before an older revalidation backlog [spec: facts/reconcile-pending-first]', async () => {
    const revalidating = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    for (const [i, id] of revalidating.entries()) {
      await insertFact(id, 'published', '2026-01-01T00:00:00.000Z', `2026-01-01T0${i}:00:00.000Z`)
    }
    const pending = crypto.randomUUID()
    await insertFact(pending, 'pending', '2026-01-02T00:00:00.000Z', null)

    const { facts } = createDeps(env)
    const cutoff = '2026-01-03T00:00:00.000Z'

    expect(await facts.listStuckBefore(cutoff, 2)).toEqual([pending, revalidating[0]])
    expect(await facts.listStuckBefore(cutoff, 1)).toEqual([pending])
    expect(new Set(await facts.listStuckBefore(cutoff, 10))).toEqual(new Set([pending, ...revalidating]))
  })
})
