import type { managedEntrySchema } from '@shared/catalog'
import type { WorkItemOverview } from '@shared/monitor'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { fact, review } from '@/test/console-api'
import { factHealth, lastChange, taskCounts } from './scores'

describe('entry scores', () => {
  const entryId = crypto.randomUUID()
  const senseId = crypto.randomUUID()
  const view = (facts: ReturnType<typeof fact>[]) =>
    ({
      entry: { id: entryId },
      senses: [{ id: senseId }],
      facts,
    }) as unknown as z.infer<typeof managedEntrySchema>

  it('counts live own facts and the flawed ones, ignoring relations pointing in', () => {
    const facts = [
      fact({ kind: 'entry', payload: {}, subject_id: entryId }),
      fact({ kind: 'sense', payload: { gloss: 'x' }, subject_id: senseId, review: review({ verdict: 'uncertain' }) }),
      fact({ kind: 'sense', payload: { gloss: 'y' }, subject_id: senseId, status: 'pending', review: null }),
      fact({ kind: 'sense', payload: { gloss: 'z' }, subject_id: senseId, status: 'rejected' }),
      fact({ kind: 'relation', payload: { type: 'synonym', target_sense_id: senseId as never } }),
    ]
    expect(factHealth(view(facts))).toEqual({ live: 3, flagged: 1 })
    expect(lastChange(view([]))).toBeNull()
    const later = fact({ kind: 'entry', payload: {}, updated_at: '2026-11-09T00:00:00.000Z' })
    expect(lastChange(view([...facts, later]))).toBe(later)
  })

  it('counts open tasks by where they stand', () => {
    const tasks = ['queued', 'queued', 'stuck', 'in_progress'].map((status) => ({ status }) as WorkItemOverview)
    expect(taskCounts(tasks)).toEqual({ queued: 2, in_progress: 1, waiting_on_review: 0, stuck: 1 })
  })
})
