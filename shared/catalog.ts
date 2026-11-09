import { z } from 'zod'
import {
  accentSchema,
  entryIdSchema,
  factIdSchema,
  factKindSchema,
  factSchema,
  factStatusSchema,
  formTypeSchema,
  glossSchema,
  posSchema,
  registerSchema,
  relationTypeSchema,
  senseIdSchema,
  strengthSchema,
  verdictSchema,
} from './facts'

export const lemmaInputSchema = z.string().trim().min(1).max(100)

// Every published fact on the public surface carries its id and how sure review was.
const factMeta = {
  id: factIdSchema,
  confidence: z.number().min(0).max(1),
  verdict: verdictSchema,
}
export const factMetaSchema = z.object(factMeta).meta({ id: 'FactMeta' })
export type FactMeta = z.infer<typeof factMetaSchema>

export const publicFormSchema = z
  .object({ ...factMeta, form: z.string(), type: formTypeSchema, pos: posSchema.optional() })
  .meta({ id: 'Form' })
export const publicPronunciationSchema = z
  .object({
    ...factMeta,
    ipa: z.string(),
    accent: accentSchema,
    strength: strengthSchema.optional(),
    pos: posSchema.optional(),
  })
  .meta({ id: 'Pronunciation' })
export const publicExampleSchema = z.object({ ...factMeta, text: z.string() }).meta({ id: 'Example' })
export const publicTranslationSchema = z
  .object({ ...factMeta, language: z.string(), text: z.string() })
  .meta({ id: 'Translation' })

export const senseRefSchema = z
  .object({ id: senseIdSchema, lemma: z.string(), pos: posSchema, gloss: z.string() })
  .meta({ id: 'SenseRef' })

export const publicRelationSchema = z
  .object({
    ...factMeta,
    type: relationTypeSchema,
    direction: z.enum(['outgoing', 'incoming']).meta({
      description: 'outgoing: this sense is the subject (e.g. this IS-A target). incoming: the other sense is.',
    }),
    sense: senseRefSchema,
  })
  .meta({ id: 'Relation' })
export type PublicRelation = z.infer<typeof publicRelationSchema>

export const publicSenseSchema = z
  .object({
    id: senseIdSchema,
    pos: posSchema,
    gloss: z.string(),
    register: registerSchema.optional(),
    fact: factMetaSchema,
    examples: z.array(publicExampleSchema),
    translations: z.array(publicTranslationSchema),
    relations: z.array(publicRelationSchema),
  })
  .meta({ id: 'Sense' })
export type PublicSense = z.infer<typeof publicSenseSchema>

export const publicEntrySchema = z
  .object({
    id: entryIdSchema,
    lemma: z.string(),
    fact: factMetaSchema,
    forms: z.array(publicFormSchema),
    pronunciations: z.array(publicPronunciationSchema),
    senses: z.array(publicSenseSchema),
  })
  .meta({ id: 'Entry' })
export type PublicEntry = z.infer<typeof publicEntrySchema>

export const entryRefSchema = z.object({ id: entryIdSchema, lemma: z.string() }).meta({ id: 'EntryRef' })
export type EntryRef = z.infer<typeof entryRefSchema>

export const publicSenseWithEntrySchema = publicSenseSchema
  .extend({ entry: entryRefSchema })
  .meta({ id: 'SenseWithEntry' })
export type PublicSenseWithEntry = z.infer<typeof publicSenseWithEntrySchema>

export const entryPageSchema = z
  .object({ items: z.array(entryRefSchema), next_cursor: z.string().nullable() })
  .meta({ id: 'EntryPage' })

export const formMatchSchema = z.object({ entry: entryRefSchema, form: publicFormSchema }).meta({ id: 'FormMatch' })
export const formLookupSchema = z.object({ items: z.array(formMatchSchema) }).meta({ id: 'FormLookup' })
export type FormMatch = z.infer<typeof formMatchSchema>

// Management surface: nodes as stored plus every fact in every status.
export const entryNodeSchema = z
  .object({ id: entryIdSchema, lemma: z.string(), created_by: z.string(), created_at: z.iso.datetime() })
  .meta({ id: 'EntryNode' })
export const senseNodeSchema = z
  .object({
    id: senseIdSchema,
    entry_id: entryIdSchema,
    pos: posSchema,
    created_by: z.string(),
    created_at: z.iso.datetime(),
  })
  .meta({ id: 'SenseNode' })

export const managedEntrySchema = z
  .object({
    entry: entryNodeSchema,
    seed: z.boolean().meta({ description: 'The entry was submitted as part of a seed list.' }),
    senses: z.array(senseNodeSchema),
    facts: z
      .array(factSchema)
      .meta({ description: 'Facts about the entry and its senses, plus relations pointing at its senses.' }),
  })
  .meta({ id: 'ManagedEntry' })

const countSchema = z.number().int().nonnegative()

export const entrySummarySchema = z
  .object({
    id: entryIdSchema,
    lemma: z.string(),
    entry_status: factStatusSchema
      .nullable()
      .meta({ description: 'Status of the live entry fact, else of the most recent one; null when none exists.' }),
    sense_count: countSchema.meta({ description: 'Senses whose gloss is live (pending or published).' }),
    fact_counts: z
      .record(factStatusSchema, countSchema)
      .meta({ description: 'Facts about the entry and its senses, by status.' }),
    last_worked_at: z.iso.datetime().nullable().meta({ description: 'When an agent last completed work on it.' }),
    created_at: z.iso.datetime(),
  })
  .meta({ id: 'EntrySummary' })
export type EntrySummary = z.infer<typeof entrySummarySchema>

export const entrySummaryPageSchema = z
  .object({ items: z.array(entrySummarySchema), next_cursor: z.string().nullable() })
  .meta({ id: 'EntrySummaryPage' })

export const nodeLocationSchema = z
  .object({ node_type: z.enum(['entry', 'sense']), entry: entryRefSchema })
  .meta({ id: 'NodeLocation' })
export type NodeLocation = z.infer<typeof nodeLocationSchema>

export const createEntryInputSchema = z
  .object({
    lemma: lemmaInputSchema,
    seed: z.boolean().optional().meta({
      description:
        'Marks the entry as part of a seed list, so the worklist serves it before never-claimed entries outside the list. Once set it stays set; false or absent changes nothing.',
    }),
  })
  .meta({ id: 'CreateEntryInput' })
export type CreateEntryInput = z.infer<typeof createEntryInputSchema>
export const createEntryResultSchema = z
  .object({ entry: entryNodeSchema, fact: factSchema, created: z.boolean() })
  .meta({ id: 'CreateEntryResult' })

export const createSenseInputSchema = z
  .object({ entry_id: entryIdSchema, pos: posSchema, gloss: glossSchema, register: registerSchema.optional() })
  .meta({ id: 'CreateSenseInput' })
export type CreateSenseInput = z.infer<typeof createSenseInputSchema>
export const createSenseResultSchema = z
  .object({ sense: senseNodeSchema, fact: factSchema, created: z.boolean() })
  .meta({ id: 'CreateSenseResult' })

export const statsSchema = z
  .object({
    facts: z.array(z.object({ kind: factKindSchema, status: factStatusSchema, count: z.number().int().nonnegative() })),
    open_feedback: z.number().int().nonnegative(),
  })
  .meta({ id: 'Stats' })
export type Stats = z.infer<typeof statsSchema>
