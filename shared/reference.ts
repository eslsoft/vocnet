import { z } from 'zod'
import { posSchema } from './facts'

// Reference data: word frequency and CEFR level imported from external datasets. It is not
// produced by agents and not reviewed; every value names the source it came from.

export const referenceSourceIdSchema = z.string().min(1).meta({ id: 'ReferenceSourceId' })

export const cefrLevelSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).meta({ id: 'CefrLevel' })
export type CefrLevel = z.infer<typeof cefrLevelSchema>

export const frequencySchema = z
  .object({
    zipf: z.number().meta({ description: 'log10 of occurrences per billion words; 7 is "the", 1 is very rare.' }),
    rank: z
      .number()
      .int()
      .positive()
      .meta({ description: '1 plus the number of imported word forms with a higher Zipf value.' }),
    source_id: referenceSourceIdSchema,
  })
  .meta({ id: 'Frequency' })
export type Frequency = z.infer<typeof frequencySchema>

export const cefrSchema = z
  .object({ pos: posSchema, level: cefrLevelSchema, source_id: referenceSourceIdSchema })
  .meta({ id: 'Cefr' })
export type Cefr = z.infer<typeof cefrSchema>

/** Reference data about a lemma: CEFR by its exact spelling, frequency by its case-insensitive word form. */
export const lemmaReferenceSchema = z.object({
  frequency: frequencySchema.nullable().meta({
    description:
      'Frequency of the case-insensitive word form, shared by every capitalization of the lemma; null when the source does not list the form.',
  }),
  cefr: z
    .array(cefrSchema)
    .meta({ description: 'CEFR level of the exact lemma per part of speech, from the vocabulary profiles.' }),
})
export type LemmaReference = z.infer<typeof lemmaReferenceSchema>

export const referenceSourceSchema = z
  .object({
    id: referenceSourceIdSchema,
    name: z.string(),
    version: z.string(),
    license: z.string(),
    license_url: z.url().meta({ description: 'Where the full license terms are.' }),
    changes: z.string().meta({ description: 'What Vocnet changed in the source data, as its license asks to state.' }),
    attribution: z.string().meta({ description: 'Credit to show wherever the data from this source is shown.' }),
    url: z.url(),
    retrieved_at: z.iso.date(),
  })
  .meta({ id: 'ReferenceSource' })
export type ReferenceSource = z.infer<typeof referenceSourceSchema>

export const referenceSourceListSchema = z
  .object({ items: z.array(referenceSourceSchema) })
  .meta({ id: 'ReferenceSourceList' })
