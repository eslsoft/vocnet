import { type FeedbackStatus, feedbackPageSchema } from '@shared/feedback'
import { decodeApiResponse, rpc } from '@/shared/api/client'

export async function listFeedback(status: FeedbackStatus | undefined, cursor: string | undefined) {
  const response = await rpc.manage.v1.feedback.$get({ query: { status, cursor, limit: '25' } })
  return decodeApiResponse(response, feedbackPageSchema)
}
