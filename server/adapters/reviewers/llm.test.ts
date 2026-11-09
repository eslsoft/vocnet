import { ReviewerProtocolError } from '@server/usecases/ports'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLlmReviewer } from './llm'

const llm = createLlmReviewer({ baseUrl: 'https://models.test', apiKey: 'secret', model: 'gpt-test' })
const prompt = { system: 'Judge.', user: 'Is this right?' }

function reply(content: string) {
  const calls: Request[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    calls.push(new Request(input, init))
    return Response.json({ model: 'gpt-test-2026', choices: [{ message: { content } }] })
  })
  return calls
}

describe('LLM reviewer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('asks chat completions for a JSON object and parses the judgement', async () => {
    const calls = reply(JSON.stringify({ verdict: 'uncertain', confidence: 0.4, reason: 'Ambiguous.' }))
    await expect(llm.judge(prompt)).resolves.toEqual({
      model: 'gpt-test-2026',
      verdict: 'uncertain',
      confidence: 0.4,
      reason: 'Ambiguous.',
    })
    const [call] = calls
    expect(call?.url).toBe('https://models.test/v1/chat/completions')
    expect(await call?.json()).toEqual({
      model: 'gpt-test',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Judge.' },
        { role: 'user', content: 'Is this right?' },
      ],
    })
  })

  it('rejects content that is not JSON or not a judgement', async () => {
    reply('I think it passes.')
    await expect(llm.judge(prompt)).rejects.toBeInstanceOf(ReviewerProtocolError)
    vi.restoreAllMocks()
    reply(JSON.stringify({ verdict: 'maybe', confidence: 0.4, reason: 'x' }))
    await expect(llm.judge(prompt)).rejects.toBeInstanceOf(ReviewerProtocolError)
  })

  it('rejects a completion without choices', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ model: 'm', choices: [] }))
    await expect(llm.judge(prompt)).rejects.toBeInstanceOf(ReviewerProtocolError)
  })
})
