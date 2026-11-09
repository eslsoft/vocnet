import type { JevReviewer } from '@server/usecases/ports'
import { ReviewerProtocolError } from '@server/usecases/ports'
import { z } from 'zod'
import { type ModelGatewayConfig, postJson } from './gateway'

const responseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) })),
})

const sameKeys = (left: string[], right: string[]) => JSON.stringify(left.sort()) === JSON.stringify(right.sort())

export function createJevReviewer(config: ModelGatewayConfig & { model: string }): JevReviewer {
  return {
    async ask(questions, state) {
      const raw = await postJson(config, 'v1/systemone', {
        model: config.model,
        state,
        questions: Object.fromEntries(
          Object.entries(questions).map(([key, instructions]) => [key, { type: 'noul', instructions }]),
        ),
      })
      const parsed = responseSchema.safeParse(raw)
      if (!parsed.success)
        throw new ReviewerProtocolError('Jev response does not match its contract.', { cause: parsed.error })
      if (!sameKeys(Object.keys(parsed.data.answers), Object.keys(questions))) {
        throw new ReviewerProtocolError('Jev answered a different question set than it was asked.')
      }
      const answers = Object.fromEntries(Object.entries(parsed.data.answers).map(([key, answer]) => [key, answer.noul]))
      return { model: parsed.data.model, answers }
    },
  }
}
