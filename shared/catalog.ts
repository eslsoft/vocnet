import { z } from 'zod'
import {
  accentSchema,
  collocationPatternSchema,
  dependentPrepositionSchema,
  entryIdSchema,
  factIdSchema,
  factKindSchema,
  factSchema,
  factStatusSchema,
  formTypeSchema,
  glossSchema,
  grammarPatternSchema,
  grammarPayloadSchema,
  morphemeSchema,
  posSchema,
  registerSchema,
  senseIdSchema,
  strengthSchema,
  topicIdSchema,
  verdictSchema,
} from './facts'
import { cefrLevelSchema, frequencySchema, lemmaReferenceSchema } from './reference'

export const lemmaInputSchema = z.string().trim().min(1).max(100)

// The public surface: a learner's dictionary entry and the summaries every list returns. Review
// metadata appears only with ?include=review, and translations only in the requested language.

/** A BCP 47 language tag such as zh or zh-CN. */
export const languageTagSchema = z
  .string()
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/, 'A language is a BCP 47 tag such as zh or zh-CN, or all.')
  .max(35)

export const langQuerySchema = z
  .union([z.literal('all'), languageTagSchema])
  .optional()
  .meta({
    description:
      'The language of translations and topic names: a BCP 47 tag, or all for every language keyed by tag. Wins over Accept-Language. A tag also reads translations tagged with a prefix of it (zh-CN reads zh).',
  })

export const includeQuerySchema = z
  .literal('review')
  .optional()
  .meta({ description: 'review adds the fact id, confidence, and verdict behind each published claim.' })

export const responseLangSchema = z.string().nullable().meta({
  description:
    'The language translations and topic names are in: ?lang= when given, else the preferred tag of Accept-Language; all for every language; null when neither names one, and then translations are omitted.',
})

/** The review behind one published claim, shown with ?include=review. */
export const reviewMetaSchema = z
  .object({ fact_id: factIdSchema, confidence: z.number().min(0).max(1), verdict: verdictSchema })
  .meta({ id: 'ReviewMeta', description: 'The published fact behind a claim; only with ?include=review.' })
export type ReviewMeta = z.infer<typeof reviewMetaSchema>
const review = { review: reviewMetaSchema.optional() }

const byLanguage = <T extends z.ZodType>(value: T) => z.record(z.string(), value)

export const translationsSchema = z.union([z.array(z.string()), byLanguage(z.array(z.string()))]).meta({
  id: 'Translations',
  description:
    'The translations in the requested language (empty when there are none; no other language stands in), or with lang=all an object keyed by language tag. Absent without a language.',
})

export const summaryTranslationSchema = z.union([z.string(), byLanguage(z.string())]).meta({
  id: 'SummaryTranslation',
  description:
    "The first sense's first translation in the requested language, or with lang=all an object keyed by language tag. Absent without a language or when there is none.",
})

const summaryFields = {
  lemma: z.string(),
  cefr: cefrLevelSchema.nullable(),
  translation: summaryTranslationSchema.optional(),
}

export const wordSummarySchema = z
  .object({
    ...summaryFields,
    pos: z.array(posSchema).meta({ description: "The parts of speech of the entry's meanings, in meaning order." }),
    cefr: cefrLevelSchema
      .nullable()
      .meta({ description: 'The lowest CEFR level of the lemma; null when it has none.' }),
    gloss: z.string().nullable().meta({ description: 'The gloss of the first sense; null when no sense is public.' }),
  })
  .meta({ id: 'WordSummary', description: 'An entry as every list shows it.' })
export type WordSummary = z.infer<typeof wordSummarySchema>

export const senseSummarySchema = z
  .object({
    ...summaryFields,
    sense_id: senseIdSchema,
    pos: posSchema,
    cefr: cefrLevelSchema
      .nullable()
      .meta({ description: "The lemma's CEFR level for this part of speech; null when it has none." }),
    gloss: z.string(),
    translation: summaryTranslationSchema
      .optional()
      .meta({ description: "This sense's first translation in the requested language; as WordSummary otherwise." }),
  })
  .meta({ id: 'SenseSummary', description: 'One sense as a topic listing shows it.' })
export type SenseSummary = z.infer<typeof senseSummarySchema>

export const publicFrequencySchema = frequencySchema
  .omit({ source_id: true })
  .meta({ id: 'WordFrequency', description: 'Word frequency; GET /v1/sources names the source.' })

export const publicPronunciationSchema = z
  .object({ ipa: z.string(), accent: accentSchema, strength: strengthSchema.optional(), ...review })
  .meta({ id: 'Pronunciation' })
export type PublicPronunciation = z.infer<typeof publicPronunciationSchema>

export const variantSchema = z
  .object({ form: z.string(), pos: posSchema.optional(), ...review })
  .meta({ id: 'Variant', description: 'An accepted spelling variant or alternative form of the whole word.' })
export type Variant = z.infer<typeof variantSchema>

export const morphologyPartSchema = morphemeSchema
  .extend({
    lemma: z.string().optional().meta({
      description: 'The public entry with exactly this spelling, when there is one: GET /v1/entries/{lemma}.',
    }),
  })
  .meta({ id: 'MorphologyPart' })

export const publicMorphologySchema = z
  .object({
    parts: z.array(morphologyPartSchema),
    family: z.array(wordSummarySchema).meta({
      description: 'Other public entries whose word formation shares a base or root with this one, in lemma order.',
    }),
    ...review,
  })
  .meta({ id: 'Morphology' })

export const inflectionTypeSchema = formTypeSchema.exclude(['variant']).meta({ id: 'InflectionType' })
export type InflectionType = z.infer<typeof inflectionTypeSchema>

export const formsSchema = z.partialRecord(inflectionTypeSchema, z.array(z.string())).meta({
  id: 'Forms',
  description: 'The inflected forms of this part of speech by type; a type with several accepted forms lists each.',
})
export type Forms = z.infer<typeof formsSchema>

export const relatedSenseSchema = z
  .object({ lemma: z.string(), sense_id: senseIdSchema, gloss: z.string(), ...review })
  .meta({ id: 'RelatedSense' })
export type RelatedSense = z.infer<typeof relatedSenseSchema>

export const relationGroupSchema = z.enum(['synonyms', 'antonyms', 'broader', 'narrower', 'part_of', 'parts'])
export type RelationGroup = z.infer<typeof relationGroupSchema>

export const relationsSchema = z
  .object({
    synonyms: z.array(relatedSenseSchema),
    antonyms: z.array(relatedSenseSchema),
    broader: z.array(relatedSenseSchema).meta({ description: 'This sense is a kind of each of these.' }),
    narrower: z.array(relatedSenseSchema).meta({ description: 'Each of these is a kind of this sense.' }),
    part_of: z.array(relatedSenseSchema).meta({ description: 'This sense is a part of each of these.' }),
    parts: z.array(relatedSenseSchema).meta({ description: 'Each of these is a part of this sense.' }),
  })
  .meta({ id: 'Relations' })
export type Relations = z.infer<typeof relationsSchema>

export const senseTopicSchema = z
  .object({
    id: topicIdSchema,
    name: byLanguage(z.string()).meta({
      description:
        'The English name under en, and the name in the requested language under its tag, when there is one.',
    }),
    ...review,
  })
  .meta({ id: 'SenseTopic' })
export type SenseTopic = z.infer<typeof senseTopicSchema>

export const publicGrammarSchema = grammarPayloadSchema
  .extend({
    patterns: z.array(grammarPatternSchema),
    prepositions: z.array(dependentPrepositionSchema),
    ...review,
  })
  .meta({ id: 'Grammar' })
export type PublicGrammar = z.infer<typeof publicGrammarSchema>

export const publicExampleSchema = z.object({ text: z.string(), ...review }).meta({ id: 'Example' })
export const publicCollocationSchema = z
  .object({ text: z.string(), pattern: collocationPatternSchema, ...review })
  .meta({ id: 'Collocation' })

export const senseReviewSchema = z
  .object({
    gloss: reviewMetaSchema.meta({ description: 'The gloss fact, which also carries the labels.' }),
    translations: z
      .union([z.array(reviewMetaSchema), byLanguage(z.array(reviewMetaSchema))])
      .optional()
      .meta({ description: 'One per translation, in the same order and shape.' }),
  })
  .meta({ id: 'SenseReview' })

export const publicSenseSchema = z
  .object({
    id: senseIdSchema,
    gloss: z.string(),
    labels: z.array(registerSchema).meta({ description: 'Usage labels; empty for neutral standard English.' }),
    rare: z.boolean().meta({
      description:
        "true: a rare, archaic, technical, or specialist sense the entry's sense list puts after its common ones. Common senses come first, most common first; senses the list does not name yet come last with false.",
    }),
    translations: translationsSchema.optional(),
    grammar: publicGrammarSchema.nullable(),
    examples: z.array(publicExampleSchema),
    collocations: z.array(publicCollocationSchema),
    topics: z.array(senseTopicSchema).meta({ description: 'Leaf topics of GET /v1/topics this sense is tagged with.' }),
    relations: relationsSchema,
    review: senseReviewSchema.optional(),
  })
  .meta({ id: 'Sense' })
export type PublicSense = z.infer<typeof publicSenseSchema>

export const meaningSchema = z
  .object({
    pos: posSchema,
    cefr: cefrLevelSchema
      .nullable()
      .meta({ description: 'CEFR level of the lemma in this part of speech; null when it has none.' }),
    pronunciations: z.array(publicPronunciationSchema).meta({
      description: "Only pronunciations particular to this part of speech; the entry's pronunciations are the default.",
    }),
    forms: formsSchema,
    senses: z.array(publicSenseSchema),
    review: z
      .object({ forms: z.partialRecord(inflectionTypeSchema, z.array(reviewMetaSchema)) })
      .optional()
      .meta({ description: 'One per form, in the same order as forms.' }),
  })
  .meta({ id: 'Meaning', description: 'The senses of one part of speech.' })
export type Meaning = z.infer<typeof meaningSchema>

export const publicEntrySchema = z
  .object({
    lang: responseLangSchema,
    id: entryIdSchema,
    lemma: z.string(),
    frequency: publicFrequencySchema.nullable(),
    pronunciations: z
      .array(publicPronunciationSchema)
      .meta({ description: 'The default pronunciations; a meaning lists the ones particular to its part of speech.' }),
    variants: z.array(variantSchema),
    morphology: publicMorphologySchema.nullable(),
    meanings: z.array(meaningSchema).meta({
      description:
        "One per part of speech, in the order of each one's first sense; senses follow the entry's sense list.",
    }),
    phrases: z
      .array(wordSummarySchema)
      .meta({ description: 'Public multiword entries with this lemma as one of their words, in lemma order.' }),
    review: z
      .object({ entry: reviewMetaSchema, sense_list: reviewMetaSchema.nullable() })
      .optional()
      .meta({ description: 'The entry fact, and the sense list that orders the senses; null when none is published.' }),
  })
  .meta({ id: 'Entry' })
export type PublicEntry = z.infer<typeof publicEntrySchema>

export const publicSenseDetailSchema = publicSenseSchema
  .extend({ lang: responseLangSchema, pos: posSchema, entry: wordSummarySchema })
  .meta({
    id: 'SenseDetail',
    description: 'One sense in the shape of the entry document, with its entry as a summary.',
  })
export type PublicSenseDetail = z.infer<typeof publicSenseDetailSchema>

export const entryPageSchema = z
  .object({ lang: responseLangSchema, items: z.array(wordSummarySchema), next_cursor: z.string().nullable() })
  .meta({ id: 'EntryPage' })

export const formMatchSchema = wordSummarySchema
  .extend({
    matches: z.array(z.object({ type: formTypeSchema, pos: posSchema.optional() })).meta({
      description: 'Each published form of the entry with this spelling, with the part of speech it inflects.',
    }),
  })
  .meta({ id: 'FormMatch' })
export type FormMatch = z.infer<typeof formMatchSchema>
export const formLookupSchema = z
  .object({ lang: responseLangSchema, items: z.array(formMatchSchema) })
  .meta({ id: 'FormLookup' })

export const entryRefSchema = z.object({ id: entryIdSchema, lemma: z.string() }).meta({ id: 'EntryRef' })
export type EntryRef = z.infer<typeof entryRefSchema>

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
