import { z } from 'zod'
import {
  accentSchema,
  closableGapSchema,
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
  regionSchema,
  registerSchema,
  relationDomainSchema,
  senseIdSchema,
  shorteningSchema,
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
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/, 'A language is a BCP 47 tag such as zh or zh-CN.')
  .max(35)

const LANGUAGE_MATCHING =
  'A tag reads a served language only in the same script: zh, zh-Hans, zh-CN and zh-SG read zh (Simplified Chinese); zh-Hant, zh-TW, zh-HK and zh-MO read none; another tag reads a language it equals or adds only a region to. A tag that reads none gives no language.'

/** ?lang= of a document read: a language tag, or all (in any case) for every language. */
export const langQuerySchema = languageTagSchema.optional().meta({
  description: `The language of translations and topic names: a BCP 47 tag, or all for every language keyed by tag. Wins over Accept-Language. ${LANGUAGE_MATCHING}`,
})

/** ?lang= of a list: one language, so every summary has one shape. */
export const listLangQuerySchema = languageTagSchema
  .refine((tag) => tag.toLowerCase() !== 'all', {
    message: 'lang=all is accepted only by GET /v1/entries/{lemma} and GET /v1/senses/{id}; a list shows one language.',
  })
  .optional()
  .meta({
    description: `The language of translations: a BCP 47 tag (all is rejected; lists show one language). Wins over Accept-Language. ${LANGUAGE_MATCHING}`,
  })

export const includeQuerySchema = z
  .literal('review')
  .optional()
  .meta({ description: 'review adds the fact id, confidence, and verdict behind each published claim.' })

export const responseLangSchema = z.string().nullable().meta({
  description:
    'The stored language tag translations and topic names are in (zh is Simplified Chinese): the one ?lang= reads when given, else the one the most preferred Accept-Language tag reads; all for every language; null when no language is read, and then translations are omitted.',
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
    "The translations in the response's language (empty when there are none; no other language or script stands in), or with lang=all an object keyed by language tag. Absent without a language.",
})

export const summaryTranslationSchema = z.string().meta({
  id: 'SummaryTranslation',
  description:
    "The first sense's first translation in the response's language. Absent without a language, with lang=all, or when there is none.",
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
      description:
        'The public entry the part is, when there is one: the entry a base names, else the entry spelled exactly like the part. GET /v1/entries/{lemma}.',
    }),
  })
  .meta({ id: 'MorphologyPart' })

export const publicMorphologySchema = z
  .object({
    parts: z.array(morphologyPartSchema),
    shortened: shorteningSchema.optional().meta({
      description: 'For a shortened word (an abbreviation, contraction, clipping, or blend), what it is short for.',
    }),
    family: z.array(wordSummarySchema).meta({
      description:
        'Other public entries whose word formation shares a base or root with this one, a base by the entry it names, in lemma order: a base word lists the words built on it.',
    }),
    ...review,
  })
  .meta({ id: 'Morphology' })

export const inflectionTypeSchema = formTypeSchema.exclude(['variant']).meta({ id: 'InflectionType' })
export type InflectionType = z.infer<typeof inflectionTypeSchema>

export const publicFormSchema = z
  .object({
    form: z.string(),
    irregular: z.boolean().meta({
      description: 'true: no regular spelling rule gives the form from the lemma ("went", "children", "better").',
    }),
    ipa: z.string().optional().meta({ description: 'The broad IPA of the form in `accent`, when one is published.' }),
    accent: accentSchema.optional(),
  })
  .meta({ id: 'Form' })
export type PublicForm = z.infer<typeof publicFormSchema>

export const formsSchema = z.partialRecord(inflectionTypeSchema, z.array(publicFormSchema)).meta({
  id: 'Forms',
  description: 'The inflected forms of this part of speech by type; a type with several accepted forms lists each.',
})
export type Forms = z.infer<typeof formsSchema>

export const relatedSenseSchema = z
  .object({
    lemma: z.string(),
    sense_id: senseIdSchema,
    gloss: z.string(),
    domain: relationDomainSchema.optional().meta({
      description:
        'The specialist taxonomy of this broader or narrower term, shown only when the read asks for that domain; absent in the everyday layer.',
    }),
    ...review,
  })
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
        "The English name under en, and the name in the response's language under its tag (every language with lang=all), when there is one.",
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

export const publicExampleSchema = z
  .object({
    text: z.string(),
    translation: z
      .union([z.string(), byLanguage(z.string())])
      .optional()
      .meta({
        description:
          "The sentence in the response's language, when one is published; by language tag with lang=all; absent without a language.",
      }),
    ...review,
  })
  .meta({ id: 'Example' })
export type PublicExample = z.infer<typeof publicExampleSchema>
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
    region: regionSchema
      .nullable()
      .meta({ description: 'british or american for a sense used in only that variety; null when both use it.' }),
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

export const gapClosureReviewSchema = reviewMetaSchema
  .extend({
    gap: closableGapSchema,
    sense_id: senseIdSchema
      .nullable()
      .meta({ description: 'The sense a sense gap is closed for; null for the entry.' }),
    reason: z.string(),
  })
  .meta({
    id: 'GapClosureReview',
    description: 'A reviewed claim that a slot is genuinely empty for this word, such as collocations of a month name.',
  })
export type GapClosureReview = z.infer<typeof gapClosureReviewSchema>

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
    syllables: z.array(z.string()).nullable().meta({
      description:
        'The written word divided into syllables, as a learner\'s dictionary breaks it: ["a", "bil", "i", "ty"].',
    }),
    morphology: publicMorphologySchema.nullable(),
    meanings: z.array(meaningSchema).meta({
      description:
        "One per part of speech, in the order of each one's first sense; senses follow the entry's sense list.",
    }),
    phrases: z
      .array(wordSummarySchema)
      .meta({ description: 'Public multiword entries with this lemma as one of their words, in lemma order.' }),
    review: z
      .object({
        entry: reviewMetaSchema,
        sense_list: reviewMetaSchema.nullable(),
        syllables: reviewMetaSchema.nullable(),
        closures: z.array(gapClosureReviewSchema).meta({
          description:
            "The published gap closures of the entry and its shown senses: slots a learner's dictionary has nothing for.",
        }),
      })
      .optional()
      .meta({
        description:
          'The entry fact, the sense list that orders the senses, the syllables (null when none is published), and the gap closures.',
      }),
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

export const memberSchema = senseSummarySchema
  .extend({
    depth: z.number().int().positive().meta({
      description: 'How many broader-term links lead from the member up to the category: 1 for a direct kind.',
    }),
  })
  .meta({
    id: 'Member',
    description: 'A sense that is a kind of the category, directly or through narrower categories.',
  })
export type Member = z.infer<typeof memberSchema>

export const memberPageSchema = z
  .object({ lang: responseLangSchema, items: z.array(memberSchema), next_cursor: z.string().nullable() })
  .meta({ id: 'MemberPage', description: 'The members of a category, nearest first, then by lemma.' })

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

/** What a search hit matched: its lemma (exactly or as a prefix), or a gloss, translation, or example of one of its senses. */
export const searchMatchSchema = z.enum(['lemma', 'gloss', 'translation', 'example']).meta({ id: 'SearchMatch' })
export type SearchMatch = z.infer<typeof searchMatchSchema>

export const searchHitSchema = wordSummarySchema
  .extend({
    match: searchMatchSchema.meta({
      description:
        'What matched, by rank: lemma (the exact lemma first, then lemmas that start with the query), then gloss, translation (in the response language), and example.',
    }),
  })
  .meta({ id: 'SearchHit' })
export type SearchHit = z.infer<typeof searchHitSchema>
export const searchPageSchema = z
  .object({ lang: responseLangSchema, items: z.array(searchHitSchema), next_cursor: z.string().nullable() })
  .meta({ id: 'SearchPage' })

export const searchQueryTextSchema = z.string().trim().min(1).max(100).meta({
  description:
    'An English headword or its start, English words that a gloss or example holds, or words of a translation in the response language, such as 银行. Matches exactly as spelled after case folding: no typo correction or stemming.',
})

/** Each value of a query parameter given repeated, comma-separated, or both. */
const listValues = (value: string | string[]) => [value].flat().join(',').split(',')

/** ?level= of a list: CEFR levels, repeated or comma-separated. */
export const levelFilterSchema = z
  .union([z.string(), z.array(z.string())])
  .transform(listValues)
  .pipe(z.array(cefrLevelSchema).min(1))
  .optional()
  .meta({ description: 'CEFR levels, repeated (level=A1&level=A2) or comma-separated (level=A1,A2).' })

export const entrySortSchema = z.enum(['lemma', 'frequency']).default('lemma').meta({
  description: 'lemma: alphabetical. frequency: most frequent first, entries without a frequency last, then by lemma.',
})
export type EntrySort = z.infer<typeof entrySortSchema>

export const senseSortSchema = z.enum(['lemma', 'frequency', 'level']).default('lemma').meta({
  description:
    "lemma: alphabetical, then by sense. frequency: by the entry's frequency, most frequent first. level: by the CEFR level of the sense's part of speech, lowest first. Unranked or unlevelled senses come last; ties go by lemma, then sense.",
})
export type SenseSort = z.infer<typeof senseSortSchema>

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
        "Share of the slots the gaps count (the sense inventory, a us and a uk pronunciation, for a single word its paradigm forms, word formation, syllables, and a pronunciation per irregular form, three phrases for a core verb (one a CEFR list names as an A1-A2 verb), and per sense outside the sense list's extra the category, parts, and synonym slots, topic, grammar, and collocation its part of speech needs, its examples, a zh translation, and a translated example) that live facts fill or a live gap closure closes; 1 means no gaps. Computed from the facts on read, never stored.",
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
  .object({
    entry_id: entryIdSchema,
    pos: posSchema,
    gloss: glossSchema,
    register: registerSchema.optional(),
    region: regionSchema.optional(),
  })
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
