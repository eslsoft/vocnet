import { z } from 'zod'
import { mediaIdSchema } from './media'

// The fact vocabulary on the wire. Runtime schemas are authoritative; types are
// inferred. The domain registry (server/domain/fact-kinds.ts) is keyed by the
// same kinds and owns everything about them that is not wire shape.

export const entryIdSchema = z.uuid().brand<'EntryId'>()
export type EntryId = z.infer<typeof entryIdSchema>

export const entryRefSchema = z.object({ id: entryIdSchema, lemma: z.string() }).meta({ id: 'EntryRef' })
export type EntryRef = z.infer<typeof entryRefSchema>
export const senseIdSchema = z.uuid().brand<'SenseId'>()
export type SenseId = z.infer<typeof senseIdSchema>
export const factIdSchema = z.uuid().brand<'FactId'>()
export type FactId = z.infer<typeof factIdSchema>
export const sentenceIdSchema = z.uuid().brand<'SentenceId'>()
export type SentenceId = z.infer<typeof sentenceIdSchema>
export const topicIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'A topic id is lowercase words joined by hyphens.')
  .max(64)
  .brand<'TopicId'>()
  .meta({ description: 'A stable topic id from GET /v1/topics, such as hospital.' })
export type TopicId = z.infer<typeof topicIdSchema>

export const posSchema = z
  .enum([
    'noun',
    'verb',
    'adjective',
    'adverb',
    'pronoun',
    'determiner',
    'number',
    'preposition',
    'conjunction',
    'interjection',
    'auxiliary',
  ])
  .meta({
    id: 'PartOfSpeech',
    description:
      'The part of speech as a learner\'s dictionary labels it. number: a cardinal or ordinal number word in its number use ("two", "hundred", "first"), which learner\'s dictionaries label number or ordinal number.',
  })
export type Pos = z.infer<typeof posSchema>

export const relationTypeSchema = z.enum(['synonym', 'antonym', 'hypernym', 'part_of']).meta({ id: 'RelationType' })
export type RelationType = z.infer<typeof relationTypeSchema>

/**
 * The specialist taxonomies a hypernym may belong to. A hypernym without a domain is in the
 * everyday layer, the categories a learner uses (dog: animal, pet); one with a domain is in that
 * domain's taxonomy (dog: canine in biology), which public reads hide unless asked for.
 */
export const relationDomainSchema = z.enum(['biology', 'medicine']).meta({
  id: 'RelationDomain',
  description:
    'A specialist taxonomy: biology (dog is a kind of canine) or medicine. A hypernym without one is in the everyday layer, the category words a learner uses (dog is a kind of animal, and of pet).',
})
export type RelationDomain = z.infer<typeof relationDomainSchema>

export const formTypeSchema = z
  .enum([
    'plural',
    'past',
    'past_participle',
    'present_participle',
    'third_person_singular',
    'comparative',
    'superlative',
    'variant',
  ])
  .meta({ id: 'FormType' })
export type FormType = z.infer<typeof formTypeSchema>

export const accentSchema = z.enum(['us', 'uk']).meta({ id: 'Accent' })

export const registerSchema = z
  .enum(['informal', 'slang', 'taboo', 'literary', 'formal', 'dated', 'offensive', 'technical', 'ironic'])
  .meta({ id: 'Register', description: 'Usage label of a sense outside neutral standard English.' })
export type Register = z.infer<typeof registerSchema>

export const regionSchema = z
  .enum([
    'british',
    'american',
    'australian',
    'new_zealand',
    'canadian',
    'irish',
    'scottish',
    'south_african',
    'indian',
  ])
  .meta({
    id: 'Region',
    description:
      'The variety of English a sense is used in, when only one uses it: british for a BrE-only sense ("lorry", "queue up"), american for an AmE-only one ("truck", "sidewalk"), australian for an Australian-only one ("arvo"), scottish for a Scottish-only one ("stay" meaning to live somewhere). Absent means every variety.',
  })
export type Region = z.infer<typeof regionSchema>

export const strengthSchema = z.enum(['strong', 'weak']).meta({
  id: 'PronunciationStrength',
  description: 'weak: the unstressed form of a function word, such as /tə/ for "to".',
})

export const countabilitySchema = z.enum(['countable', 'uncountable', 'both']).meta({
  id: 'Countability',
  description: 'Whether a noun sense takes a/an and a plural (countable), neither (uncountable), or both.',
})

export const transitivitySchema = z.enum(['transitive', 'intransitive', 'both']).meta({
  id: 'Transitivity',
  description: 'Whether a verb sense takes a direct object (transitive), never does (intransitive), or both.',
})

export const adjectivePositionSchema = z.enum(['attributive_only', 'predicative_only', 'both']).meta({
  id: 'AdjectivePosition',
  description:
    'attributive_only: only before a noun ("the main reason"). predicative_only: only after a linking verb ("the baby is asleep"). both: before a noun and after a linking verb ("a big house", "the house is big"). Absent means not stated.',
})

export const adverbPositionSchema = z.enum(['front', 'mid', 'end']).meta({
  id: 'AdverbPosition',
  description:
    'Where the adverb usually goes in a clause: front, before the subject ("Suddenly, the lights went out"); mid, between the subject and the main verb or after the first auxiliary or be ("I usually walk", "She has just left"); end, after the verb and its object ("He works hard").',
})

export const agreementSchema = z
  .enum(['singular_noun', 'plural_noun', 'uncountable_noun', 'of_plural', 'singular_verb', 'plural_verb'])
  .meta({
    id: 'Agreement',
    description:
      'What a determiner or pronoun goes with. singular_noun: before a singular countable noun ("each day", "either side"). plural_noun: before a plural noun ("many books", "any questions"). uncountable_noun: before an uncountable noun ("much time", "any milk"). of_plural: followed by of and a plural noun or pronoun ("each of the boys", "either of them"). singular_verb: takes a singular verb as subject ("everybody is", "each has"). plural_verb: takes a plural verb as subject ("both are", "few were").',
  })
export type Agreement = z.infer<typeof agreementSchema>

export const nounNumberSchema = z.enum(['singular_only', 'plural_only']).meta({
  id: 'NounNumber',
  description:
    'singular_only: used only in the singular ("a while", "the sun"). plural_only: used only in the plural, with a plural verb and never with a or an ("jeans", "trousers", "scissors"), which a learner\'s dictionary marks [plural] in place of countable or uncountable.',
})

export const nounArticleSchema = z.enum(['with_the', 'zero_article']).meta({
  id: 'NounArticle',
  description:
    'with_the: usually used with "the" in this sense ("the internet", "the environment"). zero_article: used without an article in this sense ("in hospital", "go to school", "by car").',
})

export const grammarPatternSchema = z
  .enum([
    'to_infinitive',
    'bare_infinitive',
    'ing_form',
    'that_clause',
    'wh_clause',
    'object_to_infinitive',
    'object_bare_infinitive',
    'object_ing',
    'two_objects',
    'object_complement',
    'of_ing',
  ])
  .meta({ id: 'GrammarPattern', description: 'A construction that commonly follows the word in this sense.' })
export type GrammarPattern = z.infer<typeof grammarPatternSchema>

// The prepositions and adverb particles a verb or adjective sense depends on, as learner's
// dictionaries write them ("rely on/upon sb/sth"). Time and place adjuncts such as during, since,
// and until are never selected by a word, so they are not listed.
export const dependentPrepositionSchema = z
  .enum([
    'about',
    'above',
    'across',
    'after',
    'against',
    'along',
    'among',
    'around',
    'as',
    'at',
    'before',
    'behind',
    'below',
    'beside',
    'between',
    'beyond',
    'by',
    'down',
    'for',
    'from',
    'in',
    'into',
    'like',
    'near',
    'of',
    'off',
    'on',
    'onto',
    'out',
    'out of',
    'over',
    'past',
    'round',
    'through',
    'to',
    'toward',
    'towards',
    'under',
    'up',
    'upon',
    'with',
    'within',
    'without',
  ])
  .meta({
    id: 'DependentPreposition',
    description:
      'A preposition or adverb particle that commonly follows the word in this sense, such as on in "rely on".',
  })
export type DependentPreposition = z.infer<typeof dependentPrepositionSchema>

export const morphemeRoleSchema = z.enum(['prefix', 'root', 'suffix', 'base']).meta({
  id: 'MorphemeRole',
  description:
    'base: a present-day English word the word is built on ("happy" in "unhappiness"), or the word itself in a simple word. prefix and suffix: affixes, written with their hyphen ("un-", "-ness"). root: a bound Latin or Greek stem ("spect"), read from stored formations only; a submission names none, since a word not built on a present-day English word is a simple word.',
})
export type MorphemeRole = z.infer<typeof morphemeRoleSchema>

export const collocationPatternSchema = z
  .enum([
    'verb_noun',
    'adjective_noun',
    'noun_noun',
    'adverb_adjective',
    'verb_adverb',
    'verb_preposition',
    'noun_preposition',
    'adjective_preposition',
    'phrase',
    'subject_verb',
    'verb_adjective',
    'passive',
  ])
  .meta({
    id: 'CollocationPattern',
    description:
      'The word classes the collocation combines, in order. subject_verb: a noun subject with its verb ("the room spins"). verb_adjective: a verb with an adjective that completes it ("go bankrupt", "squash flat"). passive: a past participle with its by-phrase ("tormented by guilt"). A verb with a particle after it is verb_adverb ("tack down"); a verb, preposition, and noun is verb_preposition ("return to one\'s birthplace").',
  })
export type CollocationPattern = z.infer<typeof collocationPatternSchema>

const text = (max: number) => z.string().trim().min(1).max(max)

/** What a view adds to a stored id so a reader needs no further read: the sentence's text, the entry's lemma. */
const viewText = z.string().optional().meta({
  description:
    "Views only: the named sentence's text or entry's lemma. Never stored; a submission names the node by id or by text.",
})

const GLOSS_START = /^[\p{Lu}\p{N}"'“‘(]/u
const GLOSS_EXAMPLE_MARKER = /\b(as in|e\.g\.|for example|for instance)(?=\W|$)/i
const QUOTED_SENTENCE = /(^|[\s(])['‘"“][^'‘"“’”]*[.!?]['’"”](?=$|[\s.,;:)!?])/

/** A gloss defines one sense in dictionary style; its examples are example facts. */
export const glossSchema = z
  .string()
  .trim()
  .min(6, 'A gloss is at least 6 characters.')
  .max(300, 'A gloss is at most 300 characters.')
  .refine((gloss) => GLOSS_START.test(gloss), 'A gloss starts with a capital letter, a digit, a quote, or "(".')
  .refine((gloss) => gloss.endsWith('.'), 'A gloss ends with a period.')
  .refine(
    (gloss) => !GLOSS_EXAMPLE_MARKER.test(gloss) && !QUOTED_SENTENCE.test(gloss),
    'A gloss has no examples ("as in", "e.g.", "for example", or a quoted sentence); submit each example as an example fact.',
  )
  .meta({ description: 'One sense in dictionary style: "To move quickly on foot." Examples go in example facts.' })

const IPA_SEPARATOR = /[,;/|[\]()]/
// Broad English IPA in the house style of the Oxford learner's dictionaries. One spelling per sound
// keeps transcriptions comparable: r (not ɹ), ɡ (not g), tʃ (not ʧ), ər and ɜːr (not the r-coloured
// ɚ and ɝ), and no syllable dots.
const IPA_SYMBOLS = new Set([
  ...'aeiouæɑɒɐɔəɛɜɪʊʌɨɵʉ',
  ...'bdfhjklmnprstvwzðθʃʒŋɡʔɾɫʍxç',
  ...'ˈˌːˑ ',
  ...'ʰʷᵊ\u0329\u032f\u0303\u0361',
])
const IPA_SPELLINGS: Record<string, string> = {
  ɹ: 'r',
  g: 'ɡ',
  ':': 'ː',
  "'": 'ˈ',
  ʧ: 'tʃ',
  ʤ: 'dʒ',
  ɚ: 'ər in American, ə in British',
  ɝ: 'ɜːr in American, ɜː in British',
  '.': 'nothing: no syllable dots',
}

/** The house spelling of an American transcription: the DRESS vowel is e, as in /bed/ and /ker/. */
export const US_IPA_ISSUE =
  'An American ipa writes the vowel of "bed" as e, not ɛ ("bed" is bed, "care" is ker), as learner\'s dictionaries do.'
const usIpaFits = ({ ipa, accent }: { ipa?: string; accent?: string }) => accent !== 'us' || !ipa?.includes('ɛ')

/** One broad IPA transcription, without delimiters. */
export const ipaSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (ipa) => !IPA_SEPARATOR.test(ipa),
    'An ipa holds exactly one transcription without slashes, brackets, parentheses, commas, semicolons, or bars; submit each pronunciation as its own fact.',
  )
  .superRefine((ipa, ctx) => {
    const foreign = [...new Set(ipa.normalize('NFC'))].filter(
      (symbol) => !IPA_SYMBOLS.has(symbol) && !IPA_SEPARATOR.test(symbol),
    )
    if (foreign.length === 0) return
    const advice = foreign.map((symbol) =>
      IPA_SPELLINGS[symbol] ? `"${symbol}" (write ${IPA_SPELLINGS[symbol]})` : `"${symbol}"`,
    )
    ctx.addIssue({
      code: 'custom',
      message: `An ipa uses broad English IPA symbols only; replace ${advice.join(', ')}.`,
    })
  })
  .meta({ description: 'One broad IPA transcription without slashes or syllable dots, such as ˈwɔtər.' })

// A zh text uses fullwidth punctuation, as Chinese is written; ASCII marks are typing slips.
const ASCII_PUNCTUATION = /[;,()]/
const ZH_PUNCTUATION_ISSUE = 'A zh text uses fullwidth punctuation: write ； ， （ ） in place of ASCII ; , ( ).'
const ALTERNATIVES = '；'

/** The alternatives of a zh translation, as its fullwidth semicolons separate them. */
const alternativesOf = (text: string) => text.split(ALTERNATIVES).map((alternative) => alternative.trim())

const zhText = (max: number) => text(max).refine((value) => !ASCII_PUNCTUATION.test(value), ZH_PUNCTUATION_ISSUE)

export const grammarPayloadSchema = z.strictObject({
  countability: countabilitySchema.optional().meta({
    description: 'Noun senses only, and required for them unless number is plural_only; a plural-only noun takes none.',
  }),
  number: nounNumberSchema
    .optional()
    .meta({ description: 'Noun senses only; plural_only stands in place of countability.' }),
  article: nounArticleSchema.optional().meta({ description: 'Noun senses only.' }),
  transitivity: transitivitySchema.optional().meta({ description: 'Verb senses only, and required for them.' }),
  position: z.union([adjectivePositionSchema, adverbPositionSchema]).optional().meta({
    description:
      'Adjective senses: attributive_only, predicative_only, or both. Adverb senses: the usual position, front, mid, or end.',
  }),
  agreement: z.array(agreementSchema).min(1).max(4).optional().meta({
    description: 'Determiner and pronoun senses only, and required for them: what the word goes with.',
  }),
  patterns: z
    .array(grammarPatternSchema)
    .min(1)
    .max(6)
    .optional()
    .meta({ description: 'The common patterns of the sense, not necessarily all of them.' }),
  prepositions: z.array(dependentPrepositionSchema).min(1).max(4).optional().meta({
    description:
      'The prepositions learners use after the word in this sense, such as ["on", "upon"] for rely or ["in"] for the noun interest; not necessarily all of them.',
  }),
})

export const morphemeSchema = z
  .strictObject({
    form: text(30),
    role: morphemeRoleSchema,
    meaning: text(60).optional().meta({ description: 'A short meaning, mainly for an affix: "not" for un-.' }),
    lemma: text(100).optional().meta({
      description:
        'Base parts only: the lemma of the live entry this base is, exactly as the entry spells it ("study" for the base of "student"), so the base word lists this one in its word family. Never the word itself. A word made from another word without an affix is one base part, the word itself, naming that word: a conversion with a spelling change ("shelve", lemma "shelf") or a back-formation ("televise", lemma "television").',
    }),
  })
  .meta({ id: 'Morpheme' })
export type Morpheme = z.infer<typeof morphemeSchema>

export const shorteningTypeSchema = z.enum(['abbreviation', 'contraction', 'clipping', 'blend']).meta({
  id: 'ShorteningType',
  description:
    'abbreviation: letters standing for a word or words ("Mrs", "a.m."). contraction: words run together with letters left out ("o\'clock"). clipping: a part of a longer word ("phone"). blend: parts of two words joined ("brunch").',
})
export type ShorteningType = z.infer<typeof shorteningTypeSchema>

export const shorteningSchema = z
  .strictObject({
    type: shorteningTypeSchema,
    of: text(100).meta({
      description:
        'What it shortens, written in full: "mistress" for Mrs, "of the clock" for o\'clock, "telephone" for phone, "breakfast and lunch" for brunch.',
    }),
  })
  .meta({ id: 'Shortening' })
export type Shortening = z.infer<typeof shorteningSchema>

const morphologyPayloadSchema = z.strictObject({
  parts: z.array(morphemeSchema).min(1).max(8).meta({
    description:
      'The parts in written order. A simple word is one base part, the word itself; unhappiness is un- (prefix), happy (base), -ness (suffix). A word not built on a present-day English word ("important", "factory") is a simple word.',
  }),
  shortened: shorteningSchema.optional().meta({
    description:
      'A shortened word only (an abbreviation, contraction, clipping, or blend): what it is short for. Its parts are one base part, the word itself, with no lemma.',
  }),
})

const MORPHEME_FORMS: Record<MorphemeRole, RegExp> = {
  prefix: /^\p{L}+-$/u,
  suffix: /^-\p{L}+$/u,
  root: /^\p{L}+$/u,
  // A base is a word, abbreviations and contractions included: "o'clock", "Mrs", "a.m.".
  base: /^\p{L}+(?:[-'’.]\p{L}+)*\.?$/u,
}
export const MORPHEME_SPELLING: Record<MorphemeRole, string> = {
  prefix: 'a prefix is letters ending in a hyphen ("un-")',
  suffix: 'a suffix is a hyphen followed by letters ("-ness")',
  root: 'a root is letters only ("spect")',
  base: 'a base is a word ("happy"), an abbreviation, or a contraction ("o\'clock", "a.m.")',
}
/**
 * Parts read prefixes, then at least one base, then suffixes; only a base names a lemma. A word
 * formation is synchronic: a bound Latin or Greek root is etymology, so a submission names none and
 * a word not built on a present-day English word is one base. A shortened word is one base part,
 * the word itself, so its source is `shortened`, never a lemma.
 */
function morphologyIssues({
  parts,
  shortened,
}: {
  parts: ReadonlyArray<{ form: string; role: MorphemeRole; lemma?: string }>
  shortened?: Shortening
}): string[] {
  const misspelt = parts.filter(({ form, role }) => !MORPHEME_FORMS[role].test(form))
  const issues = misspelt.map(({ form, role }) => `"${form}" is not a ${role}: ${MORPHEME_SPELLING[role]}.`)
  for (const { form } of parts.filter((part) => part.role === 'root')) {
    issues.push(
      `"${form}" is a root; a part is a present-day English word (base), a prefix, or a suffix. A word not built on a present-day English word is a simple word: one base part, the word itself ("important", "factory").`,
    )
  }
  for (const { form, role } of parts.filter((part) => part.lemma !== undefined && part.role !== 'base')) {
    issues.push(`"${form}" is a ${role}; only a base part names the lemma of the entry it is.`)
  }
  const roles = parts.map((part) => part.role)
  const stems = roles.flatMap((role, at) => (role === 'base' ? [at] : []))
  const [firstStem] = stems
  const lastStem = stems.at(-1)
  if (firstStem === undefined || lastStem === undefined) {
    issues.push('A word formation has at least one base part.')
  } else if (roles.some((role, at) => (role === 'prefix' && at > firstStem) || (role === 'suffix' && at < lastStem))) {
    issues.push('Parts are in written order: prefixes, then the bases, then suffixes.')
  }
  if (parts.length === 1 && roles[0] !== 'base') issues.push('A word of one part is a simple word: its part is a base.')
  if (shortened && (parts.length !== 1 || parts[0]?.lemma !== undefined)) {
    issues.push(
      `A shortened word is one base part, the word itself, without a lemma; "${shortened.of}" goes in shortened.of only.`,
    )
  }
  return issues
}

/** The most senses one inventory lists. */
export const MAX_INVENTORY_SENSES = 100

export const senseRankSchema = z.enum(['common', 'extra']).meta({
  id: 'SenseRank',
  description:
    "common: a general-knowledge sense a learner's dictionary lists; the common senses come first, most common first across parts of speech. extra: a rare, archaic, technical, or specialist sense; extras never count toward completeness.",
})
export type SenseRank = z.infer<typeof senseRankSchema>

const inventorySenseSchema = z
  .strictObject({
    id: senseIdSchema.optional().meta({
      description:
        'An existing sense of the entry, kept with everything attached to it. Omit it for a new sense: publishing the inventory creates the sense.',
    }),
    pos: posSchema,
    gloss: text(500),
    register: registerSchema.optional(),
    region: regionSchema.optional(),
    rank: senseRankSchema,
  })
  .meta({ id: 'InventorySense' })
export type InventorySense = z.infer<typeof inventorySenseSchema>

/** A stored inventory names every sense by id: submitting it assigns ids to the new ones. */
const storedInventorySenseSchema = inventorySenseSchema.extend({ id: senseIdSchema })
export type StoredInventorySense = z.infer<typeof storedInventorySenseSchema>

const sensesPayloadSchema = z.strictObject({
  senses: z.array(storedInventorySenseSchema).min(1).max(MAX_INVENTORY_SENSES).meta({
    description:
      'Every sense of the entry in display order: the common senses first, most common first across parts of speech, then the extra ones.',
  }),
})

/** The most phrases one headword lists. */
export const MAX_HEADWORD_PHRASES = 200

export const phraseTypeSchema = z.enum(['phrasal_verb', 'compound', 'idiom', 'fixed_phrase', 'saying']).meta({
  id: 'PhraseType',
  description:
    'phrasal_verb: a verb with a particle ("give up"). compound: a fixed compound naming one thing ("bank account"). idiom: a phrase whose meaning is not the sum of its words ("put the cart before the horse"). fixed_phrase: a set prepositional or grammatical phrase ("at all", "in front of"). saying: a complete sentence, a proverb, maxim, or saying ("look before you leap"); it is a sentence, never an entry.',
})
export type PhraseType = z.infer<typeof phraseTypeSchema>

/** The phrase types that name an entry; a saying names a sentence. */
export const ENTRY_PHRASE_TYPES = ['phrasal_verb', 'compound', 'idiom', 'fixed_phrase'] as const
export const entryPhraseTypeSchema = z.enum(ENTRY_PHRASE_TYPES)
export type EntryPhraseType = z.infer<typeof entryPhraseTypeSchema>

const phraseSenseSchema = senseIdSchema.optional().meta({
  description:
    "A sense of the headword's current inventory the phrase plainly belongs to (a compound or set phrase built on that sense). Idioms, phrasal verbs, and phrases tied to no sense omit it.",
})

const submitEntryPhraseSchema = z.strictObject({
  type: entryPhraseTypeSchema,
  entry_id: entryIdSchema,
  sense_id: phraseSenseSchema,
})
const submitSayingSchema = z.strictObject({ type: z.literal('saying'), sentence_id: sentenceIdSchema })
const entryPhraseSchema = submitEntryPhraseSchema.extend({ text: viewText }).meta({ id: 'PhraseEntryItem' })
const sayingSchema = submitSayingSchema.extend({ text: viewText }).meta({ id: 'PhraseSayingItem' })

export const phraseItemSchema = z.union([entryPhraseSchema, sayingSchema]).meta({
  id: 'PhraseItem',
  description: 'One phrase of the headword: a saying names a sentence, every other type an entry.',
})
export type PhraseItem = z.infer<typeof phraseItemSchema>
export type EntryPhraseItem = z.infer<typeof entryPhraseSchema>
export type SayingItem = z.infer<typeof sayingSchema>

const phrasesPayloadSchema = z.strictObject({
  phrases: z.array(phraseItemSchema).min(1).max(MAX_HEADWORD_PHRASES).meta({
    description:
      "Every phrase of the headword a learner's dictionary prints as its phrasal verb, compound, idiom, fixed phrase, or saying, each typed and named by id.",
  }),
  migrated: z.literal(true).optional().meta({
    description:
      'Stored only by the sentences migration on a list converted from untyped phrases: its types are provisional, so it types no phrase entry and fills no phrases slot until a typed correction supersedes it. Never submitted.',
  }),
})

/** A saying is a complete sentence: it starts with a capital letter or a quote and has at least two words. */
const SENTENCE_START = /^[\p{Lu}"'“‘]/u
export const isCompleteSentence = (text: string) => SENTENCE_START.test(text.trim()) && /\S\s+\S/.test(text.trim())
export const SAYING_ISSUE =
  'A saying is a complete sentence: it starts with a capital letter and has at least two words ("Look before you leap.").'

const phraseText = text(100).refine((lemma) => /\s/.test(lemma), 'A phrase has at least two words.')
const sayingText = text(500).refine(isCompleteSentence, SAYING_ISSUE)

/** A submitted phrase names its entry or sentence by id, or by its text for the server to resolve. */
const submitPhraseItemSchema = z.union([
  submitEntryPhraseSchema,
  z.strictObject({
    type: entryPhraseTypeSchema,
    text: phraseText.meta({
      description:
        'The phrase as its entry spells it: the entry with exactly this lemma, created (not live) when there is none.',
    }),
    sense_id: phraseSenseSchema,
  }),
  submitSayingSchema,
  z.strictObject({
    type: z.literal('saying'),
    text: sayingText.meta({ description: 'The saying: the sentence with this text, created when there is none.' }),
  }),
])
export type SubmitPhraseItem = z.infer<typeof submitPhraseItemSchema>

/**
 * The languages the dataset collects translations in, and so the only ones a translation is
 * submitted in and a read serves. `zh` is Simplified Chinese.
 */
export const SERVED_LANGUAGES = ['zh'] as const
export type ServedLanguage = (typeof SERVED_LANGUAGES)[number]

export const servedLanguageSchema = z
  .enum(SERVED_LANGUAGES, {
    error: `A translation is in a served language: ${SERVED_LANGUAGES.join(', ')} (zh is Simplified Chinese).`,
  })
  .meta({ id: 'ServedLanguage' })

export const translatedSchema = z.enum(['sense', 'sentence', 'collocation']).meta({
  id: 'Translated',
  description:
    "What a translation translates: a sense (its learner's-dictionary equivalent; subject_id is the sense), a sentence (an example or a saying; subject_id is the sentence), or a collocation (subject_id is that fact).",
})
export type Translated = z.infer<typeof translatedSchema>

const formPayloadSchema = z.strictObject({
  form: text(100),
  type: formTypeSchema,
  pos: posSchema.optional().meta({
    description: 'The part of speech the form inflects, such as auxiliary for "would" and verb for "willed".',
  }),
  ipa: text(100).optional().meta({
    description:
      'The broad IPA of the form in `accent`, mainly for an irregular form: "went", "red" for the past of read.',
  }),
  accent: accentSchema.optional().meta({ description: 'The accent of `ipa`; given with it, never alone.' }),
})

const storedExampleSchema = z.strictObject({
  sentence_id: sentenceIdSchema.meta({ description: 'The sentence that illustrates the sense.' }),
})
const examplePayloadSchema = storedExampleSchema.extend({ text: viewText })

/** A submitted example names its sentence by id, or by its text for the server to find or create. */
const submitExamplePayloadSchema = z.union([
  storedExampleSchema,
  z.strictObject({
    text: text(500).meta({
      description: 'The example sentence: the sentence with this text, created when there is none.',
    }),
  }),
])

export const cefrLevelSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).meta({ id: 'CefrLevel' })
export type CefrLevel = z.infer<typeof cefrLevelSchema>

const cefrPayloadSchema = z.strictObject({
  level: cefrLevelSchema.meta({
    description:
      'The level at which a learner first learns the word in its common senses, as the CEFR word lists give it: the lowest level of the lemma.',
  }),
})

const imagePayloadSchema = z.strictObject({
  image_id: mediaIdSchema.meta({
    description:
      'A picture stored with POST /manage/v1/media: a 1024×1024 WebP of the sense, or of the example sentence.',
  }),
  sentence_id: sentenceIdSchema.optional().meta({
    description:
      'Only when the picture shows a published example of the sense rather than the sense itself: that sentence, which is always shown with the picture.',
  }),
})

const sentenceMeaningPayloadSchema = z.strictObject({
  gloss: text(500).meta({
    description:
      'What the saying means and when it is said, in dictionary style: its actual meaning, not the literal one, and never the saying itself.',
  }),
})

const translationPayloadSchema = z.strictObject({
  language: servedLanguageSchema,
  of: translatedSchema,
  text: text(500),
})

const syllablesPayloadSchema = z.strictObject({
  syllables: z.array(text(30)).min(1).max(20).meta({
    description:
      'The written word divided by its careful pronunciation, one part per vowel sound: ["a", "bil", "i", "ty"], ["e", "na", "ble"], ["com", "for", "ta", "ble"]. Joined, they spell the lemma exactly.',
  }),
})

const productiveUsePayloadSchema = z.strictObject({
  pos: posSchema.meta({
    description: "A part of speech of the entry's common senses: one fact per such part of speech.",
  }),
  native: z.boolean().meta({
    description:
      'Whether native speakers use the word in this part of speech in their own speech or writing (true) or only understand it (false): archaic and literary words and specialist terms outside general knowledge are false.',
  }),
  learner: z.boolean().meta({
    description:
      'Whether an advanced (CEFR C1) learner needs to use it (true) or only to recognise it (false): slang, jokey or strongly colloquial idioms, informal words of only one variety of English, and every word false for native are false.',
  }),
})

/** What the LLM answers when it chooses a productive use the decision model did not settle. */
/** What the LLM answers when it estimates a word's CEFR level. */
export const cefrAnswerSchema = z.object({
  level: cefrLevelSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
})

export const productiveUseAnswerSchema = z.object({
  native: z.boolean(),
  learner: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
})

/** What the LLM answers when it names the headwords a picture shows before it is told the word. */
export const blindGuessesSchema = z.object({ guesses: z.array(z.string()).min(1).max(10) })

export const factPayloadSchemas = {
  senses: sensesPayloadSchema,
  form: formPayloadSchema,
  relation: z.strictObject({
    type: relationTypeSchema,
    target_sense_id: senseIdSchema.meta({
      description:
        "A common, current sense of another entry: never one in its entry's extra senses (except as the target of a domain hypernym) or labelled dated. A sense relates to another entry by one type only, and a hypernym to it in one layer only.",
    }),
    domain: relationDomainSchema.optional().meta({
      description:
        'Only on a hypernym: the specialist taxonomy it belongs to. Absent means the everyday layer, a category word learners use.',
    }),
  }),
  pronunciation: z.strictObject({
    ipa: text(100),
    accent: accentSchema,
    strength: strengthSchema.optional().meta({ description: 'Absent means the strong (citation) form.' }),
    pos: posSchema
      .optional()
      .meta({ description: 'The part of speech this pronunciation belongs to, when it differs by POS.' }),
  }),
  example: examplePayloadSchema,
  translation: translationPayloadSchema,
  topic: z.strictObject({
    topic_id: topicIdSchema.meta({ description: 'A leaf topic of the taxonomy (GET /v1/topics), never a category.' }),
  }),
  grammar: grammarPayloadSchema,
  morphology: morphologyPayloadSchema,
  collocation: z.strictObject({
    text: text(80).meta({ description: 'The combination with the word in it, such as "make a decision".' }),
    pattern: collocationPatternSchema,
  }),
  syllables: syllablesPayloadSchema,
  phrases: phrasesPayloadSchema,
  sentence_meaning: sentenceMeaningPayloadSchema,
  productive_use: productiveUsePayloadSchema,
  image: imagePayloadSchema,
  cefr: cefrPayloadSchema,
}
export type FactPayloads = { [K in FactKind]: z.infer<(typeof factPayloadSchemas)[K]> }

// Stored facts predate some write rules, so reads parse the shape above and only submissions
// enforce the format rules.
const submitPayloadSchemas = {
  ...factPayloadSchemas,
  senses: z
    .strictObject({
      senses: z
        .array(inventorySenseSchema.extend({ gloss: glossSchema }))
        .min(1)
        .max(MAX_INVENTORY_SENSES),
    })
    .refine(
      ({ senses }) => senses.some((sense) => sense.rank === 'common'),
      'An inventory has at least one common sense.',
    )
    .refine(({ senses }) => {
      const firstExtra = senses.findIndex((sense) => sense.rank === 'extra')
      return firstExtra === -1 || senses.slice(firstExtra).every((sense) => sense.rank === 'extra')
    }, 'The common senses come first, then the extra ones.')
    .refine(({ senses }) => {
      const ids = senses.flatMap((sense) => (sense.id ? [sense.id] : []))
      return new Set(ids).size === ids.length
    }, 'An inventory names each existing sense once.'),
  example: submitExamplePayloadSchema,
  phrases: z
    .strictObject({ phrases: z.array(submitPhraseItemSchema).min(1).max(MAX_HEADWORD_PHRASES) })
    .refine(({ phrases }) => {
      const names = phrases.map((item) => ('text' in item ? `text:${item.text.toLowerCase()}` : JSON.stringify(item)))
      return new Set(names).size === names.length
    }, 'A phrase list names each phrase once.'),
  sentence_meaning: z.strictObject({ gloss: glossSchema }),
  productive_use: productiveUsePayloadSchema.refine(
    ({ native, learner }) => native || !learner,
    'A word native speakers only understand is passive for a learner too: learner is false when native is false.',
  ),
  pronunciation: factPayloadSchemas.pronunciation.extend({ ipa: ipaSchema }).refine(usIpaFits, US_IPA_ISSUE),
  form: formPayloadSchema
    .extend({ ipa: ipaSchema.optional() })
    .refine(
      ({ ipa, accent }) => (ipa === undefined) === (accent === undefined),
      'A form gives ipa and accent together.',
    )
    .refine(usIpaFits, US_IPA_ISSUE),
  relation: factPayloadSchemas.relation.refine(
    ({ type, domain }) => domain === undefined || type === 'hypernym',
    'Only a hypernym carries a domain: a specialist taxonomy layers broader terms, never synonyms, antonyms, or parts.',
  ),
  translation: translationPayloadSchema
    .extend({
      text: zhText(500).meta({
        description:
          'The translation in the language. A sense equivalent separates alternatives with fullwidth semicolons: "银行；河岸".',
      }),
    })
    .refine(
      ({ of, text }) => of !== 'sense' || new Set(alternativesOf(text)).size === alternativesOf(text).length,
      'A translation lists each alternative once: "建造；建造" repeats one.',
    )
    .refine(({ of, text }) => of !== 'sense' || text.length <= 200, 'A sense equivalent is at most 200 characters.'),
  grammar: grammarPayloadSchema
    .refine((grammar) => Object.keys(grammar).length > 0, 'A grammar fact names at least one property.')
    .refine(
      ({ patterns }) => !patterns || new Set(patterns).size === patterns.length,
      'Each grammar pattern is listed once.',
    )
    .refine(
      ({ prepositions }) => !prepositions || new Set(prepositions).size === prepositions.length,
      'Each grammar preposition is listed once.',
    )
    .refine(
      ({ agreement }) => !agreement || new Set(agreement).size === agreement.length,
      'Each grammar agreement is listed once.',
    ),
  morphology: morphologyPayloadSchema.superRefine((morphology, ctx) => {
    for (const message of morphologyIssues(morphology)) ctx.addIssue({ code: 'custom', message })
  }),
  collocation: factPayloadSchemas.collocation.extend({
    text: text(80).refine((value) => /\s/.test(value), 'A collocation has at least two words.'),
  }),
  syllables: syllablesPayloadSchema.extend({
    syllables: syllablesPayloadSchema.shape.syllables.refine(
      (syllables) => syllables.every((syllable) => !/\s/.test(syllable)),
      'A syllable has no spaces; a phrase is syllabified in the entries of its words.',
    ),
  }),
}

export type SubmitPayloads = { [K in FactKind]: z.infer<(typeof submitPayloadSchemas)[K]> }

export const factKindSchema = z
  .enum([
    'senses',
    'form',
    'relation',
    'pronunciation',
    'example',
    'translation',
    'topic',
    'grammar',
    'morphology',
    'collocation',
    'syllables',
    'phrases',
    'sentence_meaning',
    'productive_use',
    'image',
    'cefr',
  ])
  .meta({ id: 'FactKind' })
export type FactKind = z.infer<typeof factKindSchema>

export const factStatusSchema = z
  .enum(['pending', 'published', 'rejected', 'superseded', 'retracted'])
  .meta({ id: 'FactStatus' })
export type FactStatus = z.infer<typeof factStatusSchema>

export const verdictSchema = z.enum(['pass', 'uncertain', 'fail']).meta({ id: 'Verdict' })
export type Verdict = z.infer<typeof verdictSchema>

/**
 * jev: TypeSafe's decision model. luna: OpenAI's Decisions API (gpt-6-luna). llm: the general model
 * that judges a rubric and ends every chain.
 */
export const reviewerKindSchema = z.enum(['jev', 'luna', 'llm']).meta({ id: 'ReviewerKind' })
export type ReviewerKind = z.infer<typeof reviewerKindSchema>

export const reviewerChainSchema = z
  .enum(['jev', 'luna', 'llm', 'jev+llm', 'luna+llm', 'jev+luna', 'jev+luna+llm'])
  .meta({ id: 'ReviewerChain', description: 'The reviewers consulted, in order.' })
export type ReviewerChain = z.infer<typeof reviewerChainSchema>

export const CURATOR = 'curator'

export const reviewedBySchema = z.enum([...reviewerChainSchema.options, CURATOR]).meta({
  id: 'ReviewedBy',
  description: 'The reviewer chain consulted, in order, or curator: a trusted principal settled the fact by hand.',
})
export type ReviewedBy = z.infer<typeof reviewedBySchema>

export const reviewSchema = z
  .object({
    reviewer: reviewedBySchema,
    model: z.string(),
    verdict: verdictSchema,
    confidence: z.number().min(0).max(1),
    reason: z.string(),
    context: z.record(z.string(), z.unknown()).meta({ description: 'What the reviewer judged.' }),
    detail: z.record(z.string(), z.unknown()).meta({ description: 'Raw reviewer answers.' }),
    reviewed_at: z.iso.datetime(),
  })
  .meta({ id: 'Review' })
export type Review = z.infer<typeof reviewSchema>

const curationReasonSchema = z.string().trim().min(1).max(1000)

export const curationSchema = z
  .object({ reason: curationReasonSchema.meta({ description: 'Why the curator vouches for the fact.' }) })
  .meta({
    id: 'Curation',
    description:
      'Curators only: publish the fact at once with a curator review instead of sending it to the reviewer chain.',
  })

export const curateFactInputSchema = z
  .object({
    verdict: z.enum(['pass', 'fail']).meta({ description: 'pass publishes the fact; fail rejects it.' }),
    reason: curationReasonSchema,
  })
  .meta({ id: 'CurateFactInput' })
export type CurateFactInput = z.infer<typeof curateFactInputSchema>

function submitVariant<K extends FactKind>(kind: K) {
  return z.object({
    kind: z.literal(kind),
    subject_id: z.uuid().meta({
      description:
        'The node the fact is about: the entry, a sense, a sentence (a translation of a sentence, a sentence meaning), or for a translation of a collocation that fact; the kind decides which.',
    }),
    supersedes_id: factIdSchema.optional().meta({
      description:
        'The published fact this one corrects: only a published fact of the same kind and subject can be superseded.',
    }),
    payload: submitPayloadSchemas[kind],
    curation: curationSchema.optional(),
  })
}

export const submitFactInputSchema = z
  .discriminatedUnion('kind', [
    submitVariant('senses'),
    submitVariant('form'),
    submitVariant('relation'),
    submitVariant('pronunciation'),
    submitVariant('example'),
    submitVariant('translation'),
    submitVariant('topic'),
    submitVariant('grammar'),
    submitVariant('morphology'),
    submitVariant('collocation'),
    submitVariant('syllables'),
    submitVariant('phrases'),
    submitVariant('sentence_meaning'),
    submitVariant('productive_use'),
    submitVariant('image'),
    submitVariant('cefr'),
  ])
  .meta({ id: 'SubmitFactInput' })
export type SubmitFactInput = z.infer<typeof submitFactInputSchema>

function factVariant<K extends FactKind>(kind: K) {
  return z.object({
    id: factIdSchema,
    kind: z.literal(kind),
    subject_id: z.uuid(),
    object_id: z.uuid().nullable().meta({
      description:
        'The node the fact points at besides its subject: a relation its target sense, an example its sentence.',
    }),
    payload: factPayloadSchemas[kind],
    status: factStatusSchema,
    supersedes_id: factIdSchema.nullable(),
    author: z.string(),
    review: reviewSchema.nullable(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
}

export const factSchema = z
  .discriminatedUnion('kind', [
    factVariant('senses'),
    factVariant('form'),
    factVariant('relation'),
    factVariant('pronunciation'),
    factVariant('example'),
    factVariant('translation'),
    factVariant('topic'),
    factVariant('grammar'),
    factVariant('morphology'),
    factVariant('collocation'),
    factVariant('syllables'),
    factVariant('phrases'),
    factVariant('sentence_meaning'),
    factVariant('productive_use'),
    factVariant('image'),
    factVariant('cefr'),
  ])
  .meta({ id: 'Fact' })
export type FactDto = z.infer<typeof factSchema>

export const factWriteResultSchema = z
  .object({ fact: factSchema, created: z.boolean() })
  .meta({ id: 'FactWriteResult' })

export const listedFactSchema = z.intersection(factSchema, z.object({ entry: entryRefSchema })).meta({
  id: 'ListedFact',
  description: 'A fact with the entry its subject is or belongs to.',
})
export type ListedFactDto = z.infer<typeof listedFactSchema>

export const factPageSchema = z
  .object({ items: z.array(listedFactSchema), next_cursor: z.string().nullable() })
  .meta({ id: 'FactPage' })
