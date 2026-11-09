import { z } from 'zod'
import { managedEntrySchema } from './catalog'
import { entryIdSchema, senseIdSchema } from './facts'

export const workLeaseIdSchema = z.uuid().brand<'WorkLeaseId'>()
export type WorkLeaseId = z.infer<typeof workLeaseIdSchema>

export const DEFAULT_LEASE_SECONDS = 900

export const claimWorkInputSchema = z
  .object({
    lease_seconds: z
      .number()
      .int()
      .min(60)
      .max(3600)
      .optional()
      .meta({ description: `How long the lease lasts. Defaults to ${DEFAULT_LEASE_SECONDS}.` }),
  })
  .meta({ id: 'ClaimWorkInput' })
export type ClaimWorkInput = z.infer<typeof claimWorkInputSchema>

export const workLeaseSchema = z
  .object({
    id: workLeaseIdSchema,
    entry_id: entryIdSchema,
    lemma: z.string(),
    holder: z.string(),
    expires_at: z.iso.datetime(),
  })
  .meta({ id: 'WorkLease' })

const senseGap = { sense_id: senseIdSchema }

export const gapSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('senses') }),
    z.object({ type: z.literal('forms') }),
    z.object({ type: z.literal('pronunciation') }),
    z.object({ type: z.literal('relations'), ...senseGap }),
    z.object({ type: z.literal('examples'), ...senseGap }),
    z.object({ type: z.literal('translations'), ...senseGap, language: z.literal('zh') }),
  ])
  .meta({ id: 'Gap', description: 'Something the entry has no live (pending or published) fact for yet.' })
export type Gap = z.infer<typeof gapSchema>

export const workClaimSchema = z
  .object({ lease: workLeaseSchema, entry: managedEntrySchema, gaps: z.array(gapSchema) })
  .meta({ id: 'WorkClaim' })

export const completeWorkInputSchema = z
  .object({ note: z.string().trim().min(1).max(500).optional() })
  .meta({ id: 'CompleteWorkInput' })
export type CompleteWorkInput = z.infer<typeof completeWorkInputSchema>

export const workCompletionSchema = z
  .object({ entry_id: entryIdSchema, last_worked_at: z.iso.datetime() })
  .meta({ id: 'WorkCompletion' })
