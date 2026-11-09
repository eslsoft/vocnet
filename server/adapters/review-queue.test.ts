import type { FactId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { createReviewQueue, type ReviewMessage } from './review-queue'

describe('review queue', () => {
  it('sends snake_case jobs in batches of at most 100', async () => {
    const batches: Array<Array<{ body: ReviewMessage }>> = []
    const queue = { sendBatch: async (batch: Array<{ body: ReviewMessage }>) => void batches.push(batch) }
    const jobs = Array.from({ length: 150 }, (_, index) => ({ factId: `f${index}` as FactId, traceId: 't' }))
    await createReviewQueue(queue as unknown as Queue<ReviewMessage>).enqueue(jobs)
    expect(batches.map((batch) => batch.length)).toEqual([100, 50])
    expect(batches[0]?.[0]).toEqual({ body: { fact_id: 'f0', trace_id: 't' } })
  })
})
