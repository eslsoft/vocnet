import { z } from 'zod'
import {
  accentSchema,
  collocationPatternSchema,
  dependentPrepositionSchema,
  entryIdSchema,
  entryPhraseTypeSchema,
  entryRefSchema,
  factIdSchema,
  factSchema,
  factStatusSchema,
  formTypeSchema,
  grammarPatternSchema,
  grammarPayloadSchema,
  morphemeSchema,
  posSchema,
  regionSchema,
  registerSchema,
  relationDomainSchema,
  senseIdSchema,
  sentenceIdSchema,
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

/**
 * Where a level comes from: the reference CEFR lists, a list a curator imported, or the server's
 * estimate, whose credibility is lower.
 */
export const cefrSourceSchema = z.enum(['reference', 'curated', 'estimated']).meta({
  id: 'CefrSource',
  description:
    "reference: the CEFR lists the dictionary imports (CEFR-J, Octanove). curated: a list a curator imported as a cefr fact. estimated: the server's estimate, a cefr fact a model chose, exact for about half of words and within one level for nine in ten.",
})
export type CefrSource = z.infer<typeof cefrSourceSchema>

const summaryFields = {
  lemma: z.string(),
  cefr: cefrLevelSchema.nullable(),
  cefr_source: cefrSourceSchema.nullable().meta({ description: 'Where `cefr` comes from; null when it is null.' }),
  translation: summaryTranslationSchema.optional(),
  image_url: z.string().nullable().meta({
    description:
      'The URL of its picture (the media base and its id), cacheable forever: the picture its document shows as `image`; null when none is public.',
  }),
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
    category: z
      .object({ id: topicIdSchema, name: byLanguage(z.string()) })
      .nullable()
      .meta({
        description:
          'The category of GET /v1/topics the topic belongs to, named as the topic is; null when the tag names a category itself.',
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

const sentenceTranslationSchema = z
  .union([z.string(), byLanguage(z.string())])
  .optional()
  .meta({
    description:
      "The sentence in the response's language, when one is published; by language tag with lang=all; absent without a language.",
  })

export const publicExampleSchema = z
  .object({
    sentence_id: sentenceIdSchema.meta({ description: 'The sentence; GET /v1/sentences/{id}.' }),
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
export const publicPictureSchema = z
  .object({
    url: z.string().meta({ description: 'The URL of the picture (the media base and its id), cacheable forever.' }),
    sentence: z.string().nullable().meta({
      description:
        'The published example the picture shows, which is always shown with it; null when it shows the sense itself.',
    }),
    ...review,
  })
  .meta({ id: 'Picture' })
export type PublicPicture = z.infer<typeof publicPictureSchema>

export const publicCollocationSchema = z
  .object({
    text: z.string(),
    pattern: collocationPatternSchema,
    translation: z
      .union([z.string(), byLanguage(z.string())])
      .optional()
      .meta({
        description:
          "The collocation in the response's language, when one is published; by language tag with lang=all; absent without a language.",
      }),
    ...review,
  })
  .meta({ id: 'Collocation' })

export const senseReviewSchema = z
  .object({
    gloss: reviewMetaSchema.meta({
      description: "The entry's sense inventory, which states the gloss, its labels, and its rank.",
    }),
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
        "true: a rare, archaic, technical, or specialist sense the entry's inventory ranks extra, after its common ones. Common senses come first, most common first.",
    }),
    translations: translationsSchema.optional(),
    grammar: publicGrammarSchema.nullable(),
    examples: z.array(publicExampleSchema),
    collocations: z.array(publicCollocationSchema),
    topics: z.array(senseTopicSchema).meta({ description: 'Leaf topics of GET /v1/topics this sense is tagged with.' }),
    image: publicPictureSchema.nullable().meta({ description: 'Its published picture; null when it has none.' }),
    relations: relationsSchema,
    review: senseReviewSchema.optional(),
  })
  .meta({ id: 'Sense' })
export type PublicSense = z.infer<typeof publicSenseSchema>

export const skillSchema = z.enum(['listen', 'speak', 'read', 'write']).meta({ id: 'Skill' })
export type Skill = z.infer<typeof skillSchema>

const byTier = <T extends z.ZodType>(value: T) => z.object({ native: value, learner: value })

export const meaningSchema = z
  .object({
    pos: posSchema,
    cefr: cefrLevelSchema
      .nullable()
      .meta({ description: 'CEFR level of the lemma in this part of speech; null when it has none.' }),
    productive_use: byTier(z.boolean()).nullable().meta({
      id: 'ProductiveUse',
      description:
        'Whether native speakers (native) and an advanced CEFR C1 learner (learner) use the word in this part of speech themselves (true, active) or only understand it (false, passive). A part of speech with only rare senses is passive for both; null until a productive use is published.',
    }),
    skills: byTier(z.array(skillSchema)).nullable().meta({
      description:
        'The skills each tier needs the word for, derived from productive_use and the registers of the common senses: active is listen, speak, read, and write, passive listen and read, and a part of speech whose common senses are all informal (informal, slang, taboo, offensive) keeps only the spoken ones (listen, speak), all formal or literary only the written ones (read, write). null with productive_use.',
    }),
    pronunciations: z.array(publicPronunciationSchema).meta({
      description: "Only pronunciations particular to this part of speech; the entry's pronunciations are the default.",
    }),
    forms: formsSchema,
    senses: z.array(publicSenseSchema),
    review: z
      .object({
        forms: z.partialRecord(inflectionTypeSchema, z.array(reviewMetaSchema)),
        productive_use: reviewMetaSchema.nullable(),
      })
      .optional()
      .meta({
        description: 'One per form, in the same order as forms, and the productive use; null when none is published.',
      }),
  })
  .meta({ id: 'Meaning', description: 'The senses of one part of speech.' })
export type Meaning = z.infer<typeof meaningSchema>

export const publicSayingSchema = z
  .object({
    sentence_id: sentenceIdSchema,
    text: z.string(),
    meaning: z
      .string()
      .nullable()
      .meta({ description: 'What the saying means and when it is said; null until one is published.' }),
    translation: sentenceTranslationSchema,
  })
  .meta({ id: 'Saying' })
export type PublicSaying = z.infer<typeof publicSayingSchema>

export const publicPhrasesSchema = z
  .object({
    by_sense: z
      .array(z.object({ sense_id: senseIdSchema, phrases: z.array(wordSummarySchema) }))
      .meta({ description: 'Phrases filed under one sense of the headword, in sense order.' }),
    phrasal_verbs: z.array(wordSummarySchema),
    idioms: z.array(wordSummarySchema).meta({ description: 'Idioms and fixed phrases.' }),
    compounds: z.array(wordSummarySchema),
    sayings: z.array(publicSayingSchema),
  })
  .meta({
    id: 'Phrases',
    description:
      "The headword's published phrases list, grouped: phrases filed under a sense, then the rest by type, each a public phrase entry in list order; sayings are sentences.",
  })
export type PublicPhrases = z.infer<typeof publicPhrasesSchema>

export const publicSentenceSchema = z
  .object({
    lang: responseLangSchema,
    id: sentenceIdSchema,
    text: z.string(),
    source: z.string().nullable().meta({ description: 'Where the sentence comes from; null when it was made up.' }),
    meaning: z.string().nullable().meta({ description: "A saying's published meaning; null otherwise." }),
    translation: sentenceTranslationSchema,
    examples_of: z
      .array(z.object({ lemma: z.string(), sense_id: senseIdSchema }))
      .meta({ description: 'The public senses it is a published example of.' }),
    saying_of: z
      .array(z.string())
      .meta({ description: 'The public headwords whose published phrases list names it a saying.' }),
  })
  .meta({ id: 'Sentence' })
export type PublicSentence = z.infer<typeof publicSentenceSchema>

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
    cefr: cefrLevelSchema.nullable().meta({
      description:
        'The lowest CEFR level of the lemma: from the reference lists, else from its cefr fact; null when it has none.',
    }),
    cefr_source: cefrSourceSchema.nullable().meta({ description: 'Where `cefr` comes from; null when it is null.' }),
    image: publicPictureSchema
      .extend({ sense_id: senseIdSchema.meta({ description: 'The sense the picture belongs to.' }) })
      .nullable()
      .meta({
        description:
          "The entry's picture: the picture of its first sense, in inventory order, that has one; null when none has.",
      }),
    meanings: z.array(meaningSchema).meta({
      description:
        "One per part of speech, in the order of each one's first sense; senses follow the entry's inventory.",
    }),
    phrase_type: entryPhraseTypeSchema.nullable().meta({
      description:
        'For a phrase entry, its type as the earliest published phrases list naming it gives it; null for a single word or an untyped phrase.',
    }),
    phrases: publicPhrasesSchema,
    review: z
      .object({
        inventory: reviewMetaSchema,
        syllables: reviewMetaSchema.nullable(),
        phrases: reviewMetaSchema.nullable(),
        cefr: reviewMetaSchema
          .nullable()
          .meta({ description: 'The cefr fact the level comes from; null for a reference level.' }),
      })
      .optional()
      .meta({
        description:
          'The sense inventory that gives the senses, the syllables, and the phrases list (null when none is published).',
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
    parents: z.array(senseIdSchema).meta({
      description:
        'The senses this member is a direct kind of within the walk, in the layers walked: the category itself (for a direct kind) or other members. A member under two categories names both, so the members form a tree or graph by sense_id.',
    }),
  })
  .meta({
    id: 'Member',
    description: 'A sense that is a kind of the category, directly or through narrower categories.',
  })
export type Member = z.infer<typeof memberSchema>

export const memberPageSchema = z
  .object({
    lang: responseLangSchema,
    total: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: 'How many members the category has in the layers walked, over every page.' }),
    items: z.array(memberSchema),
    next_cursor: z.string().nullable(),
  })
  .meta({ id: 'MemberPage', description: 'The members of a category, nearest first, then by lemma.' })

/** How many senses of each part of speech an overview shows unless ?senses= says otherwise. */
export const OVERVIEW_SENSES = 4
/** The most lemmas one overview read takes. */
export const OVERVIEW_MAX_LEMMAS = 100

const overviewPronunciationSchema = publicPronunciationSchema.omit({ review: true })

export const entryOverviewSchema = z
  .object({
    id: entryIdSchema,
    lemma: z.string(),
    cefr: cefrLevelSchema
      .nullable()
      .meta({ description: 'The lowest CEFR level of the lemma; null when it has none.' }),
    cefr_source: cefrSourceSchema.nullable().meta({ description: 'Where `cefr` comes from; null when it is null.' }),
    frequency: publicFrequencySchema.nullable(),
    pronunciations: z
      .array(overviewPronunciationSchema)
      .meta({ description: "The entry's default pronunciations: its US and UK IPA when both are published." }),
    meanings: z.array(
      z.object({
        pos: posSchema,
        cefr: cefrLevelSchema.nullable(),
        pronunciations: z
          .array(overviewPronunciationSchema)
          .meta({ description: 'Only pronunciations particular to this part of speech.' }),
        sense_count: z
          .number()
          .int()
          .positive()
          .meta({ description: 'How many public senses the part of speech has in the entry document.' }),
        senses: z
          .array(
            z.object({
              id: senseIdSchema,
              gloss: z.string(),
              rare: z.boolean(),
              translations: z
                .array(z.string())
                .optional()
                .meta({ description: "Every translation in the response's language; absent without a language." }),
            }),
          )
          .meta({ description: 'The first senses of the part of speech, in the order of the entry document.' }),
      }),
    ),
  })
  .meta({
    id: 'EntryOverview',
    description:
      'An entry as a word card shows it: pronunciations, and per part of speech the sense count and first senses.',
  })
export type EntryOverview = z.infer<typeof entryOverviewSchema>

export const entryOverviewListSchema = z
  .object({
    lang: responseLangSchema,
    items: z
      .array(entryOverviewSchema)
      .meta({ description: 'One per lemma with a public entry, in the order asked, each once.' }),
    missing: z
      .array(z.string())
      .meta({ description: 'The lemmas asked for that have no public entry, exactly as spelled in the request.' }),
  })
  .meta({ id: 'EntryOverviewList' })

/** ?lemma= of an overview read: one lemma or the parameter repeated. A lemma may hold a comma, so values are never split. */
export const overviewLemmasSchema = z
  .union([lemmaInputSchema, z.array(lemmaInputSchema).min(1).max(OVERVIEW_MAX_LEMMAS)])
  .meta({
    description: `Exact lemmas, the parameter repeated (lemma=bright&lemma=run), at most ${OVERVIEW_MAX_LEMMAS}.`,
  })

export const overviewSensesSchema = z.coerce.number().int().min(1).max(10).default(OVERVIEW_SENSES).meta({
  description: 'How many senses of each part of speech to show; sense_count always counts them all.',
})

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

const countSchema = z.number().int().nonnegative()

export const slotCountsSchema = z
  .object({
    total: countSchema.meta({ description: 'The slots the gap rules count for the entry.' }),
    published: countSchema.meta({ description: 'Slots published facts fill, or a pass completed.' }),
    pending: countSchema.meta({ description: 'Slots only pending facts fill.' }),
  })
  .meta({ id: 'SlotCounts' })
export type SlotCounts = z.infer<typeof slotCountsSchema>

export const openWorkCountsSchema = z
  .object({ total: countSchema, in_progress: countSchema, waiting_on_review: countSchema, stuck: countSchema })
  .meta({ id: 'OpenWorkCounts', description: "The entry's open work items by where they stand." })

export const managedEntrySchema = z
  .object({
    entry: entryNodeSchema,
    live: z.boolean().meta({ description: 'An imported headword, or a phrase a published phrases list names.' }),
    batch: z.number().int().nonnegative().nullable().meta({
      description:
        "The headword batch the entry was imported in, or its headword's for a phrase; null for an entry that is not live.",
    }),
    phrase_type: entryPhraseTypeSchema
      .nullable()
      .meta({ description: 'The type the earliest published phrases list naming the entry gives it; null otherwise.' }),
    completeness: z.number().min(0).max(1).meta({
      description:
        'Share of the slots the gaps count that live facts fill or a pass completed: the sense inventory, a us and a uk pronunciation, for a single word its paradigm forms, word formation, syllables, a pronunciation per irregular form, and its phrases list; per common sense the category, parts, and synonym slots, topic, grammar, and collocation its part of speech needs, and its examples; a translation per served language of every common sense, example sentence, saying, and collocation; and a meaning per saying. A typed phrase entry counts only the slots of its type. Optional slots (phrases, family, category, parts, synonyms, topics, grammar, collocations) are complete after one pass. 1 means no gaps. Computed from the facts on read, never stored.',
    }),
    credibility: z.number().min(0).max(1).meta({
      description:
        "The lowest credibility of the entry's published facts and of its optional slots a pass left empty: how often facts of that kind, settled by that review path, are right. Audits rank by it.",
    }),
    slots: slotCountsSchema,
    senses: z.array(senseNodeSchema),
    facts: z.array(factSchema).meta({
      description:
        "Facts about the entry, its senses, and its sentences (its examples' and its sayings'), plus relations pointing at its senses. An example carries its sentence's text, a phrases item its lemma or text.",
    }),
  })
  .meta({ id: 'ManagedEntry' })

export const managedEntryDetailSchema = managedEntrySchema
  .extend(lemmaReferenceSchema.shape)
  .meta({ id: 'ManagedEntryDetail' })

export const entrySummarySchema = z
  .object({
    id: entryIdSchema,
    lemma: z.string(),
    live: z.boolean().meta({ description: 'An imported headword, or a phrase a published phrases list names.' }),
    sense_count: countSchema.meta({ description: "Senses of the entry's live inventory." }),
    fact_counts: z
      .record(factStatusSchema, countSchema)
      .meta({ description: 'Facts about the entry and its senses, by status.' }),
    last_worked_at: z.iso.datetime().nullable().meta({ description: 'When an agent last completed work on it.' }),
    created_at: z.iso.datetime(),
    level: cefrLevelSchema.nullable().meta({ description: "The lemma's lowest CEFR level; null without one." }),
    completeness: z.number().min(0).max(1).meta({ description: 'As of the last rescore; see ManagedEntry.' }),
    credibility: z.number().min(0).max(1).meta({ description: 'As of the last rescore; see ManagedEntry.' }),
    slots: slotCountsSchema,
    open_work: openWorkCountsSchema,
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
    batch: z.number().int().nonnegative().meta({
      description: 'The headword batch to admit the lemma in. Curators only: agents never create entries.',
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
export const importSkipsSchema = z
  .object({
    letters: z.array(z.string()).meta({ description: 'Single letters other than "a" and "I".' }),
    contractions: z.array(z.string()).meta({ description: 'Contractions and clitics ("\'s", "\'m", "\'re").' }),
    characters: z
      .array(z.string())
      .meta({ description: 'Lemmas with a character other than a letter, space, hyphen, or apostrophe.' }),
    inflections: z
      .array(z.object({ lemma: z.string(), base: z.string() }))
      .meta({ description: 'Regular inflections reduced to a base that is a candidate or an entry.' }),
    variants: z.array(z.object({ lemma: z.string(), of: z.string() })).meta({
      description:
        'American spellings merged into their British spelling, a candidate or an entry; recorded as its variant form when this call creates it.',
    }),
  })
  .meta({ id: 'ImportSkips', description: 'What each import filter rule skipped.' })

export const coreImportResultSchema = z
  .object({
    created: z.array(z.string()).meta({ description: 'The lemmas this call created entries for, in import order.' }),
    skipped: importSkipsSchema,
    remaining: z.number().int().nonnegative().meta({ description: 'Headwords still without an entry; 0 when done.' }),
  })
  .meta({ id: 'CoreImportResult' })
export type CoreImportResult = z.infer<typeof coreImportResultSchema>

export const retireEntryResultSchema = z
  .object({
    entry: entryNodeSchema,
    retired: z.boolean().meta({ description: 'false when the entry was not live already.' }),
  })
  .meta({ id: 'RetireEntryResult' })

export const createEntryResultSchema = z
  .object({ entry: entryNodeSchema, created: z.boolean() })
  .meta({ id: 'CreateEntryResult' })
