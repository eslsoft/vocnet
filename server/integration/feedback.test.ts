import { createEntryResultSchema } from '@shared/catalog'
import { feedbackPageSchema, feedbackReceiptSchema, feedbackSchema } from '@shared/feedback'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { call, deliverPendingReviews, issueAgentKey, stubReviewers } from './helpers'

const from = (ip: string) => ({ 'cf-connecting-ip': ip })

describe('feedback', () => {
  afterEach(() => vi.restoreAllMocks())

  it('takes public reports and leases each one to a single agent [spec: feedback/lease-api]', async () => {
    const first = await issueAgentKey('first')
    const second = await issueAgentKey('second')
    const { entry, fact } = createEntryResultSchema.parse(
      (await call('/manage/v1/entries', { method: 'POST', token: first, json: { lemma: 'tide' } })).body,
    )
    stubReviewers()
    await deliverPendingReviews()
    const report = await call('/v1/feedback', {
      method: 'POST',
      headers: from('203.0.113.1'),
      json: { target_type: 'entry', target_id: entry.id, message: 'Missing the verb sense.' },
    })
    expect(report.status).toBe(201)
    const { id } = feedbackReceiptSchema.parse(report.body)

    const open = feedbackPageSchema.parse((await call('/manage/v1/feedback?status=open', { token: first })).body)
    expect(open.items.map((item) => item.id)).toEqual([id])

    const claimed = feedbackSchema.parse(
      (await call(`/manage/v1/feedback/${id}/claim`, { method: 'POST', token: first })).body,
    )
    expect(claimed.status).toBe('claimed')
    const contested = await call(`/manage/v1/feedback/${id}/claim`, { method: 'POST', token: second })
    expect(contested.status).toBe(409)
    expect(apiErrorSchema.parse(contested.body).error.code).toBe('conflict')

    const notHolder = await call(`/manage/v1/feedback/${id}/resolve`, {
      method: 'POST',
      token: second,
      json: { resolution: 'dismissed', note: 'n' },
    })
    expect(notHolder.status).toBe(403)

    const resolved = await call(`/manage/v1/feedback/${id}/resolve`, {
      method: 'POST',
      token: first,
      json: { resolution: 'resolved', fact_ids: [fact.id] },
    })
    expect(feedbackSchema.parse(resolved.body)).toMatchObject({
      status: 'resolved',
      assignee: expect.stringMatching(/^agent:/),
    })
  })

  it('answers 404 for a target the public API does not show', async () => {
    const token = await issueAgentKey()
    const { entry } = createEntryResultSchema.parse(
      (await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'cove' } })).body,
    )
    for (const target of [
      { target_type: 'sense', target_id: '00000000-0000-4000-8000-000000000000' },
      { target_type: 'entry', target_id: entry.id },
    ]) {
      const { status, body } = await call('/v1/feedback', {
        method: 'POST',
        headers: from('203.0.113.2'),
        json: { ...target, message: 'x' },
      })
      expect([status, apiErrorSchema.parse(body).error.code]).toEqual([404, 'not_found'])
    }
  })

  it('limits each client address to 10 reports a minute [spec: feedback/rate-limit]', async () => {
    const token = await issueAgentKey()
    const { entry } = createEntryResultSchema.parse(
      (await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'bay' } })).body,
    )
    stubReviewers()
    await deliverPendingReviews()
    const report = (ip: string) =>
      call('/v1/feedback', {
        method: 'POST',
        headers: from(ip),
        json: { target_type: 'entry', target_id: entry.id, message: 'x' },
      })

    const statuses = []
    for (let attempt = 0; attempt < 10; attempt += 1) statuses.push((await report('198.51.100.9')).status)
    expect(statuses).toEqual(Array(10).fill(201))
    const limited = await report('198.51.100.9')
    expect([limited.status, apiErrorSchema.parse(limited.body).error.code]).toEqual([429, 'rate_limited'])
    expect((await report('198.51.100.10')).status).toBe(201)
  })
})
