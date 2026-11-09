import { createEntryResultSchema } from '@shared/catalog'
import { feedbackPageSchema, feedbackReceiptSchema, feedbackSchema } from '@shared/feedback'
import { apiErrorSchema } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { call, issueAgentKey } from './helpers'

describe('feedback', () => {
  it('takes public reports and leases each one to a single agent [spec: feedback/lease-api]', async () => {
    const first = await issueAgentKey('first')
    const second = await issueAgentKey('second')
    const { entry, fact } = createEntryResultSchema.parse(
      (await call('/manage/v1/entries', { method: 'POST', token: first, json: { lemma: 'tide' } })).body,
    )
    const report = await call('/v1/feedback', {
      method: 'POST',
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

  it('rejects reports about things that do not exist', async () => {
    const { status } = await call('/v1/feedback', {
      method: 'POST',
      json: { target_type: 'sense', target_id: '00000000-0000-4000-8000-000000000000', message: 'x' },
    })
    expect(status).toBe(422)
  })
})
