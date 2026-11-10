import { z } from 'zod'
import {
  accentSchema,
  collocationPatternSchema,
  entryIdSchema,
  factIdSchema,
  factKindSchema,
  factSchema,
  factStatusSchema,
  formTypeSchema,
  glossSchema,
  grammarPayloadSchema,
  morphemeSchema,
  posSchema,
  registerSchema,
  relationTypeSchema,
  senseIdSchema,
  strengthSchema,
  topicIdSchema,
  verdictSchema,
} from './facts'
import { lemmaReferenceSchema } from './reference'

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

export const publicTopicTagSchema = z.object({ ...factMeta, topic_id: topicIdSchema }).meta({ id: 'TopicTag' })
export const publicGrammarSchema = grammarPayloadSchema.extend(factMeta).meta({ id: 'Grammar' })
export const publicMorphologySchema = z
  .object({ ...factMeta, parts: z.array(morphemeSchema) })
  .meta({ id: 'Morphology' })
export const publicCollocationSchema = z
  .object({ ...factMeta, text: z.string(), pattern: collocationPatternSchema })
  .meta({ id: 'Collocation' })

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
    topics: z
      .array(publicTopicTagSchema)
      .meta({ description: 'Leaf topics of GET /v1/topics this sense is tagged with.' }),
    grammar: publicGrammarSchema.nullable(),
    collocations: z.array(publicCollocationSchema),
    common: z.boolean().nullable().meta({
      description:
        "true: one of the entry's common senses, which come first, most common first. false: a rare, archaic, technical, or specialist sense. null: the entry's published sense list does not name it (there is none yet, or the sense was added since); such senses come last.",
    }),
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
    morphology: publicMorphologySchema.nullable(),
    sense_list: factMetaSchema.nullable().meta({
      description: "The published sense list that orders `senses` and marks each one's `common`; null when none is.",
    }),
    senses: z.array(publicSenseSchema),
    ...lemmaReferenceSchema.shape,
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
    completeness: z.number().min(0).max(1).meta({
      description:
        "Share of the slots the gaps count (the sense inventory, forms, pronunciation, word formation of a single word, and per sense outside the sense list's extra the relations, topic, grammar, and collocation its part of speech needs, an example, and a zh translation) that live facts fill; 1 means no gaps.",
    }),
    quality: z.number().min(0).max(1).meta({
      description: 'One minus the share of the live facts about the entry and its senses that are weak (see WeakFact).',
    }),
    senses: z.array(senseNodeSchema),
    facts: z
      .array(factSchema)
      .meta({ description: 'Facts about the entry and its senses, plus relations pointing at its senses.' }),
  })
  .meta({ id: 'ManagedEntry' })

export const managedEntryDetailSchema = managedEntrySchema
  .extend(lemmaReferenceSchema.shape)
  .meta({ id: 'ManagedEntryDetail' })

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
        'Marks the entry as part of a seed list, a curated word list rather than a neighbor an agent found. The mark is shown in the management view and does not change the claim order. Once set it stays set; false or absent changes nothing.',
    }),
  })
  .meta({ id: 'CreateEntryInput' })
export type CreateEntryInput = z.infer<typeof createEntryInputSchema>
/** At most this many entries per core import call, which keeps one request inside the Worker's D1 query budget. */
export const CORE_IMPORT_MAX = 50

export const coreImportInputSchema = z
  .object({
    limit: z.number().int().min(1).max(CORE_IMPORT_MAX).default(CORE_IMPORT_MAX).meta({
      description: 'The most entries this call creates.',
    }),
  })
  .meta({ id: 'CoreImportInput' })
export type CoreImportInput = z.infer<typeof coreImportInputSchema>
export const coreImportResultSchema = z
  .object({
    created: z.array(z.string()).meta({ description: 'The lemmas this call created entries for, in import order.' }),
    skipped: z
      .array(z.string())
      .meta({ description: 'Headwords the import never makes entries: single letters other than "a" and "I".' }),
    remaining: z.number().int().nonnegative().meta({ description: 'Headwords still without an entry; 0 when done.' }),
  })
  .meta({ id: 'CoreImportResult' })
export type CoreImportResult = z.infer<typeof coreImportResultSchema>

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
