import type { managedEntrySchema } from '@shared/catalog'
import type { WorkItemOverview } from '@shared/monitor'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { fact } from '@/test/console-api'
import { lastChange, taskCounts } from './scores'

describe('entry scores', () => {
  const entryId = crypto.randomUUID()
  const view = (facts: ReturnType<typeof fact>[]) =>
    ({ entry: { id: entryId }, senses: [], facts }) as unknown as z.infer<typeof managedEntrySchema>

  it('finds the fact changed last', () => {
    const earlier = fact({ kind: 'syllables', payload: { syllables: ['bank'] }, subject_id: entryId })
    const later = fact({
      kind: 'example',
      payload: { sentence_id: crypto.randomUUID() as never, text: 'x' },
      updated_at: '2026-11-09T00:00:00.000Z',
    })
    expect(lastChange(view([]))).toBeNull()
    expect(lastChange(view([earlier, later]))).toBe(later)
  })

  it('counts open tasks by where they stand', () => {
    const tasks = ['queued', 'queued', 'stuck', 'in_progress'].map((status) => ({ status }) as WorkItemOverview)
    expect(taskCounts(tasks)).toEqual({ queued: 2, in_progress: 1, waiting_on_review: 0, stuck: 1 })
  })
})
