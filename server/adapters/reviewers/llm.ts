import type { LlmReviewer } from '@server/usecases/ports'
import { ReviewerProtocolError } from '@server/usecases/ports'
import { verdictSchema } from '@shared/facts'
import { z } from 'zod'
import { type ModelGatewayConfig, postJson } from './gateway'

const completionSchema = z.object({
  model: z.string().min(1),
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
})

const judgementSchema = z.object({
  verdict: verdictSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
})

function parseJudgement(content: string) {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch (cause) {
    throw new ReviewerProtocolError('LLM reviewer did not answer with JSON.', { cause })
  }
  const parsed = judgementSchema.safeParse(value)
  if (!parsed.success)
    throw new ReviewerProtocolError('LLM judgement does not match its contract.', { cause: parsed.error })
  return parsed.data
}

export function createLlmReviewer(config: ModelGatewayConfig & { model: string }): LlmReviewer {
  return {
    async judge(prompt) {
      const raw = await postJson(config, 'v1/chat/completions', {
        model: config.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      })
      const parsed = completionSchema.safeParse(raw)
      if (!parsed.success)
        throw new ReviewerProtocolError('Chat completion does not match its contract.', { cause: parsed.error })
      const [choice] = parsed.data.choices
      return { model: parsed.data.model, ...parseJudgement(choice.message.content) }
    },
  }
}
