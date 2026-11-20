import { env } from 'cloudflare:test'
import { mediaIdsSql } from '@server/adapters/replica-sql'
import { webpHeader } from '@server/testing/webp'
import { entryPageSchema, publicEntrySchema } from '@shared/catalog'
import { pictureUploadResultSchema } from '@shared/media'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  call,
  deliverPendingReviews,
  headword,
  issueAgentKey,
  LLM_URL,
  request,
  stubReviewers,
  submitOk,
} from './helpers'

const upload = (token: string, body: Uint8Array<ArrayBuffer>) =>
  call('/manage/v1/media', { method: 'POST', token, headers: { 'content-type': 'image/webp' }, body })

describe('pictures', () => {
  afterEach(() => vi.restoreAllMocks())

  it('stores a picture, reviews an image fact by looking at it, and serves it on the entry [spec: facts/image-api]', async () => {
    const token = await issueAgentKey()
    const bank = await headword('bank', [{ pos: 'noun', gloss: 'An organization that keeps money for its customers.' }])
    const picture = webpHeader(1024, 1024)

    const stored = await upload(token, picture)
    expect(stored.status).toBe(200)
    const { id, url } = pictureUploadResultSchema.parse(stored.body)
    expect(url).toBe(`/v1/media/${id}`)
    const wrong = await upload(token, webpHeader(1254, 1254))
    expect([wrong.status, apiErrorSchema.parse(wrong.body).error.code]).toEqual([400, 'invalid_request'])
    const unstored = await call('/manage/v1/facts', {
      method: 'POST',
      token,
      json: { kind: 'image', subject_id: bank.senses[0], payload: { image_id: 'e'.repeat(64) } },
    })
    expect([unstored.status, apiErrorSchema.parse(unstored.body).error.code]).toEqual([422, 'invalid_reference'])

    const fact = await submitOk(token, 'image', bank.senses[0] as string, { image_id: id })
    expect(fact).toMatchObject({ kind: 'image', status: 'pending' })
    const spy = stubReviewers({ guesses: ['bank', 'money'] })
    await deliverPendingReviews()
    const llmBodies = await Promise.all(
      spy.mock.calls
        .map(([input, init]) => new Request(input as RequestInfo, init))
        .filter((sent) => sent.url === LLM_URL)
        .map((sent) => sent.json() as Promise<{ messages: Array<{ content: unknown }> }>),
    )
    vi.restoreAllMocks()
    // The blind look and the judgement each send the picture with the prompt.
    expect(llmBodies).toHaveLength(2)
    for (const body of llmBodies) {
      expect(body.messages[1]?.content).toEqual([
        { type: 'text', text: expect.any(String) },
        { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/webp;base64,/) } },
      ])
    }

    const entry = publicEntrySchema.parse((await call('/v1/entries/bank')).body)
    expect(entry.image).toEqual({ url, sentence: null, sense_id: bank.senses[0] })
    expect(entry.meanings[0]?.senses[0]?.image).toEqual({ url, sentence: null })
    const list = entryPageSchema.parse((await call('/v1/entries')).body)
    expect(list.items.find((item) => item.lemma === 'bank')?.image_url).toBe(url)
    // A replica sync copies the picture before the entry that shows it.
    const named = await env.DB.prepare(mediaIdsSql).all<{ image_id: string }>()
    expect(named.results.map((row) => row.image_id)).toContain(id)
    const served = await request(url)
    expect([served.status, served.headers.get('content-type')]).toEqual([200, 'image/webp'])
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(picture)
  })
})
