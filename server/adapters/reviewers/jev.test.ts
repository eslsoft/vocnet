import { ReviewerProtocolError, ReviewerTransportError } from '@server/usecases/ports'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJevReviewer } from './jev'

const jev = createJevReviewer({ baseUrl: 'https://models.test/', apiKey: 'secret', model: 'jev-latest' })

function stubFetch(respond: () => Response | Promise<Response>) {
  const calls: Request[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    calls.push(new Request(input, init))
    return respond()
  })
  return calls
}

const answer = (answers: Record<string, number>) =>
  Response.json({
    model: 'jev-2026',
    answers: Object.fromEntries(Object.entries(answers).map(([key, noul]) => [key, { type: 'noul', noul }])),
  })

describe('Jev reviewer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('posts typed noul questions to systemone and returns the probabilities', async () => {
    const calls = stubFetch(() => answer({ relation: 0.91 }))
    await expect(jev.ask({ relation: 'Is it?' }, { fact: { id: 'f1' } })).resolves.toEqual({
      model: 'jev-2026',
      answers: { relation: 0.91 },
    })
    const [call] = calls
    expect(call?.url).toBe('https://models.test/v1/systemone')
    expect(call?.headers.get('authorization')).toBe('Bearer secret')
    expect(await call?.json()).toEqual({
      model: 'jev-latest',
      state: { fact: { id: 'f1' } },
      questions: { relation: { type: 'noul', instructions: 'Is it?' } },
    })
  })

  it('rejects an answer set that differs from the questions asked', async () => {
    stubFetch(() => answer({ other: 0.9 }))
    await expect(jev.ask({ relation: 'Is it?' }, {})).rejects.toBeInstanceOf(ReviewerProtocolError)
  })

  it('rejects malformed answers', async () => {
    stubFetch(() => Response.json({ model: 'm', answers: { relation: { type: 'noul', noul: 2 } } }))
    await expect(jev.ask({ relation: 'Is it?' }, {})).rejects.toBeInstanceOf(ReviewerProtocolError)
  })

  it('treats network failures, 429, and 5xx as transport errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'))
    await expect(jev.ask({ q: 'x' }, {})).rejects.toBeInstanceOf(ReviewerTransportError)
    vi.restoreAllMocks()
    stubFetch(() => new Response('busy', { status: 429 }))
    await expect(jev.ask({ q: 'x' }, {})).rejects.toBeInstanceOf(ReviewerTransportError)
    vi.restoreAllMocks()
    stubFetch(() => new Response('oops', { status: 502 }))
    await expect(jev.ask({ q: 'x' }, {})).rejects.toBeInstanceOf(ReviewerTransportError)
  })

  it('treats other rejections and non-JSON bodies as protocol errors', async () => {
    stubFetch(() => new Response('bad', { status: 400 }))
    await expect(jev.ask({ q: 'x' }, {})).rejects.toBeInstanceOf(ReviewerProtocolError)
    vi.restoreAllMocks()
    stubFetch(() => new Response('not json', { status: 200 }))
    await expect(jev.ask({ q: 'x' }, {})).rejects.toBeInstanceOf(ReviewerProtocolError)
  })
})
