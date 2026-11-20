import type { LlmPrompt } from '@server/domain/fact-kinds'
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

export function createLlmReviewer(config: ModelGatewayConfig & { model: string }): LlmReviewer {
  /** The JSON object the model answers with: chat completions in JSON mode. */
  async function answer(
    prompt: LlmPrompt,
    pictures: readonly string[] = [],
  ): Promise<{ model: string; answer: unknown }> {
    const user =
      pictures.length === 0
        ? prompt.user
        : [{ type: 'text', text: prompt.user }, ...pictures.map((url) => ({ type: 'image_url', image_url: { url } }))]
    const raw = await postJson(config, 'v1/chat/completions', {
      model: config.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: user },
      ],
    })
    const parsed = completionSchema.safeParse(raw)
    if (!parsed.success)
      throw new ReviewerProtocolError('Chat completion does not match its contract.', { cause: parsed.error })
    const [choice] = parsed.data.choices
    try {
      return { model: parsed.data.model, answer: JSON.parse(choice.message.content) as unknown }
    } catch (cause) {
      throw new ReviewerProtocolError('LLM reviewer did not answer with JSON.', { cause })
    }
  }
  return {
    answer,
    async judge(prompt, pictures) {
      const { model, answer: value } = await answer(prompt, pictures)
      const parsed = judgementSchema.safeParse(value)
      if (!parsed.success)
        throw new ReviewerProtocolError('LLM judgement does not match its contract.', { cause: parsed.error })
      return { model, ...parsed.data }
    },
  }
}
