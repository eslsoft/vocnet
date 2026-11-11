import { type FeedbackId, type FeedbackStatus, feedbackPageSchema, listedFeedbackSchema } from '@shared/feedback'
import { decodeApiResponse, rpc } from '@/shared/api/client'

const feedback = rpc.manage.v1.feedback

export async function listTickets(status: FeedbackStatus | undefined, cursor: string | undefined) {
  const response = await feedback.$get({ query: { status, cursor, limit: '25' } })
  return decodeApiResponse(response, feedbackPageSchema)
}

export async function getTicket(id: FeedbackId) {
  return decodeApiResponse(await feedback[':id'].$get({ param: { id } }), listedFeedbackSchema)
}
