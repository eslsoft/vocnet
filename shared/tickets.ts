import { z } from 'zod'
import { entryRefSchema, factIdSchema } from './facts'

export const ticketIdSchema = z.uuid().brand<'TicketId'>()
export type TicketId = z.infer<typeof ticketIdSchema>

/**
 * Everything a curator handles by hand. stuck_work: a work item that its passes did not fill.
 * feedback: a reader's report. audit: a low-confidence fact picked for a check. missing_word: a
 * lemma a pass needed that is not a live entry.
 */
export const ticketTypeSchema = z.enum(['stuck_work', 'feedback', 'audit', 'missing_word']).meta({ id: 'TicketType' })
export type TicketType = z.infer<typeof ticketTypeSchema>

export const ticketTargetTypeSchema = z.enum(['entry', 'sense', 'fact', 'lemma']).meta({
  id: 'TicketTargetType',
  description: 'What the ticket is about: a node, a fact, or (for a missing word) a lemma that is no entry.',
})
export type TicketTargetType = z.infer<typeof ticketTargetTypeSchema>

export const ticketStatusSchema = z.enum(['open', 'resolved', 'dismissed']).meta({ id: 'TicketStatus' })
export type TicketStatus = z.infer<typeof ticketStatusSchema>

/** What a reader may report on: a node or a fact. */
export const feedbackTargetTypeSchema = z.enum(['entry', 'sense', 'fact']).meta({ id: 'FeedbackTargetType' })
export type FeedbackTargetType = z.infer<typeof feedbackTargetTypeSchema>

export const submitFeedbackInputSchema = z
  .object({
    target_type: feedbackTargetTypeSchema,
    target_id: z.uuid(),
    message: z.string().trim().min(1).max(2000),
  })
  .meta({ id: 'SubmitFeedbackInput' })
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackInputSchema>

export const feedbackReceiptSchema = z
  .object({ id: ticketIdSchema, status: ticketStatusSchema })
  .meta({ id: 'FeedbackReceipt' })

export const ticketSchema = z
  .object({
    id: ticketIdSchema,
    type: ticketTypeSchema,
    target_type: ticketTargetTypeSchema,
    target: z.string().meta({ description: 'The entry, sense, or fact id, or the missing lemma.' }),
    message: z.string().meta({ description: 'Why it needs a curator: the report, the last pass note, or the audit reason.' }),
    status: ticketStatusSchema,
    resolution_note: z.string().nullable(),
    resolution_fact_ids: z.array(factIdSchema),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .meta({ id: 'Ticket' })
export type TicketDto = z.infer<typeof ticketSchema>

export const listedTicketSchema = ticketSchema
  .extend({ entry: entryRefSchema.nullable().meta({ description: 'The entry its target is or belongs to; null for a missing word.' }) })
  .meta({ id: 'ListedTicket' })
export type ListedTicketDto = z.infer<typeof listedTicketSchema>

export const ticketPageSchema = z
  .object({ items: z.array(listedTicketSchema), next_cursor: z.string().nullable() })
  .meta({ id: 'TicketPage' })

export const resolveTicketInputSchema = z
  .discriminatedUnion('resolution', [
    z.object({
      resolution: z.literal('resolved'),
      fact_ids: z.array(factIdSchema).max(50).default([]),
      note: z.string().trim().min(1).max(2000),
    }),
    z.object({
      resolution: z.literal('dismissed'),
      note: z.string().trim().min(1).max(2000),
    }),
  ])
  .meta({ id: 'ResolveTicketInput' })
export type ResolveTicketInput = z.infer<typeof resolveTicketInputSchema>
