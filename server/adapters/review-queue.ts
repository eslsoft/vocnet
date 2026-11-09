import type { ReviewJob, ReviewQueue } from '@server/usecases/ports'
import { z } from 'zod'

// Queue messages are snake_case JSON like every other wire format here.
export const reviewMessageSchema = z.object({ fact_id: z.uuid(), trace_id: z.string().min(1) })
export type ReviewMessage = z.infer<typeof reviewMessageSchema>

const SEND_BATCH_LIMIT = 100

export function createReviewQueue(queue: Queue<ReviewMessage>): ReviewQueue {
  return {
    async enqueue(jobs: ReviewJob[]) {
      for (let start = 0; start < jobs.length; start += SEND_BATCH_LIMIT) {
        const batch = jobs.slice(start, start + SEND_BATCH_LIMIT)
        await queue.sendBatch(batch.map((job) => ({ body: { fact_id: job.factId, trace_id: job.traceId } })))
      }
    },
  }
}
