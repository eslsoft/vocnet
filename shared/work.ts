import { z } from 'zod'
import { managedEntrySchema } from './catalog'
import { entryIdSchema, factIdSchema, factKindSchema, relationTypeSchema, senseIdSchema } from './facts'

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

const relationHaveSchema = z
  .object({
    type: relationTypeSchema,
    direction: z.enum(['outgoing', 'incoming']).meta({
      description: 'outgoing: the sense is the subject (e.g. this IS-A target). incoming: the other sense is.',
    }),
  })
  .meta({ id: 'RelationHave' })

export const gapSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('senses') }).meta({ description: 'The entry has no sense with a live gloss.' }),
    z
      .object({
        type: z.literal('sense_list'),
        rejected: z.number().int().nonnegative().meta({
          description:
            'How many sense lists naming exactly the current senses review rejected, counted up to two. When it is above zero, read the review reason of the latest rejected sense_list in the entry facts and fix exactly what it names: add the missing senses, merge duplicates, reorder, or move senses between common and extra. A third rejection of the same senses no longer changes the gap, so the entry stalls until something else changes it.',
        }),
      })
      .meta({
        description:
          "The entry has senses but no live sense_list naming exactly them: none was submitted, it was rejected, or it is stale because a sense was added or a listed sense's gloss is no longer live. Complete the common senses, then submit a list (superseding a published one).",
      }),
    z.object({ type: z.literal('forms') }),
    z.object({ type: z.literal('pronunciation') }),
    z
      .object({ type: z.literal('morphology') })
      .meta({ description: 'A single-word entry has no live word formation.' }),
    z.object({
      type: z.literal('relations'),
      ...senseGap,
      count: z.number().int().nonnegative().meta({
        description:
          'Live relations the sense is in, as subject or object. The gap stays open below what its part of speech needs: two for nouns, verbs, and adjectives, one for adverbs; other parts of speech have no relations gap.',
      }),
      have: z.array(relationHaveSchema).meta({
        description: 'Each relation type and direction the sense already has, once, so an agent looks for the others.',
      }),
    }),
    z.object({ type: z.literal('examples'), ...senseGap }),
    z.object({ type: z.literal('translations'), ...senseGap, language: z.literal('zh') }),
    z.object({ type: z.literal('topics'), ...senseGap }).meta({
      description:
        'The sense has no live topic fact. Nouns, verbs, and adjectives need one; other parts of speech have no topics gap.',
    }),
    z.object({ type: z.literal('grammar'), ...senseGap }).meta({
      description: 'A noun or verb sense has no live grammar fact (countability for a noun, transitivity for a verb).',
    }),
    z.object({ type: z.literal('collocations'), ...senseGap }).meta({
      description: 'A noun, verb, or adjective sense has no live collocation.',
    }),
  ])
  .meta({ id: 'Gap', description: 'Something the entry has too few live (pending or published) facts for.' })
export type Gap = z.infer<typeof gapSchema>

export const weakFactSchema = z
  .object({
    id: factIdSchema,
    kind: factKindSchema,
    reason: z.enum(['feedback', 'uncertain']).meta({
      description:
        'feedback: an open or claimed feedback item targets the fact. uncertain: the fact published on an uncertain review verdict.',
    }),
  })
  .meta({
    id: 'WeakFact',
    description: 'A live fact of the entry worth replacing: submit a correction that supersedes it, or retract it.',
  })
export type WeakFact = z.infer<typeof weakFactSchema>

export const workClaimSchema = z
  .object({
    lease: workLeaseSchema,
    entry: managedEntrySchema,
    gaps: z.array(gapSchema),
    weak_facts: z.array(weakFactSchema),
  })
  .meta({ id: 'WorkClaim' })

export const completeWorkInputSchema = z
  .object({ note: z.string().trim().min(1).max(500).optional() })
  .meta({ id: 'CompleteWorkInput' })
export type CompleteWorkInput = z.infer<typeof completeWorkInputSchema>

export const workCompletionSchema = z
  .object({ entry_id: entryIdSchema, last_worked_at: z.iso.datetime() })
  .meta({ id: 'WorkCompletion' })
