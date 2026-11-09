import { z } from 'zod'
import { factIdSchema } from './facts'

export const feedbackIdSchema = z.uuid().brand<'FeedbackId'>()
export type FeedbackId = z.infer<typeof feedbackIdSchema>

export const feedbackTargetTypeSchema = z.enum(['entry', 'sense', 'fact']).meta({ id: 'FeedbackTargetType' })
export type FeedbackTargetType = z.infer<typeof feedbackTargetTypeSchema>

export const feedbackStatusSchema = z.enum(['open', 'claimed', 'resolved', 'dismissed']).meta({ id: 'FeedbackStatus' })
export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>

export const submitFeedbackInputSchema = z
  .object({
    target_type: feedbackTargetTypeSchema,
    target_id: z.uuid(),
    message: z.string().trim().min(1).max(2000),
  })
  .meta({ id: 'SubmitFeedbackInput' })
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackInputSchema>

export const feedbackReceiptSchema = z
  .object({ id: feedbackIdSchema, status: feedbackStatusSchema })
  .meta({ id: 'FeedbackReceipt' })

export const feedbackSchema = z
  .object({
    id: feedbackIdSchema,
    target_type: feedbackTargetTypeSchema,
    target_id: z.uuid(),
    message: z.string(),
    status: feedbackStatusSchema,
    assignee: z.string().nullable(),
    claim_expires_at: z.iso.datetime().nullable(),
    resolution_note: z.string().nullable(),
    resolution_fact_ids: z.array(factIdSchema),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .meta({ id: 'Feedback' })
export type FeedbackDto = z.infer<typeof feedbackSchema>

export const feedbackPageSchema = z
  .object({ items: z.array(feedbackSchema), next_cursor: z.string().nullable() })
  .meta({ id: 'FeedbackPage' })

export const resolveFeedbackInputSchema = z
  .discriminatedUnion('resolution', [
    z.object({
      resolution: z.literal('resolved'),
      fact_ids: z.array(factIdSchema).min(1).max(50),
      note: z.string().trim().min(1).max(2000).optional(),
    }),
    z.object({
      resolution: z.literal('dismissed'),
      note: z.string().trim().min(1).max(2000),
    }),
  ])
  .meta({ id: 'ResolveFeedbackInput' })
export type ResolveFeedbackInput = z.infer<typeof resolveFeedbackInputSchema>
