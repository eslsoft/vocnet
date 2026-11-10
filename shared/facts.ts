import { z } from 'zod'

// The fact vocabulary on the wire. Runtime schemas are authoritative; types are
// inferred. The domain registry (server/domain/fact-kinds.ts) is keyed by the
// same kinds and owns everything about them that is not wire shape.

export const entryIdSchema = z.uuid().brand<'EntryId'>()
export type EntryId = z.infer<typeof entryIdSchema>
export const senseIdSchema = z.uuid().brand<'SenseId'>()
export type SenseId = z.infer<typeof senseIdSchema>
export const factIdSchema = z.uuid().brand<'FactId'>()
export type FactId = z.infer<typeof factIdSchema>
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
    'preposition',
    'conjunction',
    'interjection',
    'auxiliary',
  ])
  .meta({ id: 'PartOfSpeech' })
export type Pos = z.infer<typeof posSchema>

export const relationTypeSchema = z.enum(['synonym', 'antonym', 'hypernym', 'part_of']).meta({ id: 'RelationType' })
export type RelationType = z.infer<typeof relationTypeSchema>

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
  .enum(['informal', 'slang', 'taboo', 'literary', 'formal', 'dated', 'offensive', 'technical'])
  .meta({ id: 'Register', description: 'Usage label of a sense outside neutral standard English.' })
export type Register = z.infer<typeof registerSchema>

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

export const adjectivePositionSchema = z.enum(['attributive_only', 'predicative_only']).meta({
  id: 'AdjectivePosition',
  description:
    'attributive_only: only before a noun ("the main reason"). predicative_only: only after a linking verb ("the baby is asleep"). Absent means both.',
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
    'preposition',
  ])
  .meta({ id: 'GrammarPattern', description: 'A construction that commonly follows the word in this sense.' })
export type GrammarPattern = z.infer<typeof grammarPatternSchema>

export const morphemeRoleSchema = z.enum(['prefix', 'root', 'suffix', 'base']).meta({
  id: 'MorphemeRole',
  description:
    'base: a word of its own the word is built on ("happy" in "unhappiness"). root: a bound stem, usually Latin or Greek ("spect"). prefix and suffix: affixes, written with their hyphen ("un-", "-ness").',
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
  ])
  .meta({ id: 'CollocationPattern', description: 'The word classes the collocation combines, in order.' })
export type CollocationPattern = z.infer<typeof collocationPatternSchema>

const text = (max: number) => z.string().trim().min(1).max(max)

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
// Broad English IPA. One spelling per sound keeps transcriptions comparable: r (not ɹ), ɡ (not g), tʃ (not ʧ).
const IPA_SYMBOLS = new Set([
  ...'aeiouæɑɒɐɔəɚɛɜɝɪʊʌɨɵʉ',
  ...'bdfhjklmnprstvwzðθʃʒŋɡʔɾɫʍxç',
  ...'ˈˌːˑ. ',
  ...'ʰʷᵊ\u0329\u032f\u0303\u0361',
])
const IPA_SPELLINGS: Record<string, string> = { ɹ: 'r', g: 'ɡ', ':': 'ː', "'": 'ˈ', ʧ: 'tʃ', ʤ: 'dʒ' }

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
  .meta({ description: 'One broad IPA transcription without slashes, such as ˈwɔtər.' })

export const grammarPayloadSchema = z.strictObject({
  countability: countabilitySchema.optional().meta({ description: 'Noun senses only, and required for them.' }),
  transitivity: transitivitySchema.optional().meta({ description: 'Verb senses only, and required for them.' }),
  position: adjectivePositionSchema.optional().meta({ description: 'Adjective senses only.' }),
  patterns: z
    .array(grammarPatternSchema)
    .min(1)
    .max(6)
    .optional()
    .meta({ description: 'Verb and adjective senses only: the common patterns, not necessarily all of them.' }),
})

export const morphemeSchema = z
  .strictObject({
    form: text(30),
    role: morphemeRoleSchema,
    meaning: text(60)
      .optional()
      .meta({ description: 'A short meaning, mainly for a Latin or Greek root: "look" for spect.' }),
  })
  .meta({ id: 'Morpheme' })

const morphologyPayloadSchema = z.strictObject({
  parts: z.array(morphemeSchema).min(1).max(8).meta({
    description:
      'The parts in written order. A simple word is one base part; unhappiness is un- (prefix), happy (base), -ness (suffix).',
  }),
})

const MORPHEME_FORMS: Record<MorphemeRole, RegExp> = {
  prefix: /^\p{L}+-$/u,
  suffix: /^-\p{L}+$/u,
  root: /^\p{L}+$/u,
  base: /^\p{L}+(?:[-']\p{L}+)*$/u,
}
const MORPHEME_SPELLING: Record<MorphemeRole, string> = {
  prefix: 'a prefix is letters ending in a hyphen ("un-")',
  suffix: 'a suffix is a hyphen followed by letters ("-ness")',
  root: 'a root is letters only ("spect")',
  base: 'a base is a word ("happy")',
}
const isStem = (role: MorphemeRole) => role === 'base' || role === 'root'

/** Parts read prefixes, then at least one base or root, then suffixes. */
function morphologyIssues(parts: ReadonlyArray<{ form: string; role: MorphemeRole }>): string[] {
  const misspelt = parts.filter(({ form, role }) => !MORPHEME_FORMS[role].test(form))
  const issues = misspelt.map(({ form, role }) => `"${form}" is not a ${role}: ${MORPHEME_SPELLING[role]}.`)
  const roles = parts.map((part) => part.role)
  const stems = roles.flatMap((role, at) => (isStem(role) ? [at] : []))
  const [firstStem] = stems
  const lastStem = stems.at(-1)
  if (firstStem === undefined || lastStem === undefined) {
    issues.push('A word formation has at least one base or root part.')
  } else if (roles.some((role, at) => (role === 'prefix' && at > firstStem) || (role === 'suffix' && at < lastStem))) {
    issues.push('Parts are in written order: prefixes, then the bases or roots, then suffixes.')
  }
  if (parts.length === 1 && roles[0] !== 'base') issues.push('A word of one part is a simple word: its part is a base.')
  return issues
}

const senseIdsSchema = z.array(senseIdSchema).max(100)

const senseListPayloadSchema = z.strictObject({
  common: senseIdsSchema.min(1).meta({
    description:
      "The entry's common, general-knowledge senses, those a learner's dictionary lists, most common first across parts of speech.",
  }),
  extra: senseIdsSchema.meta({
    description:
      "The entry's other live senses: rare, archaic, technical, or specialist. They are not ordered and never count toward completeness.",
  }),
})

export const factPayloadSchemas = {
  entry: z.strictObject({}),
  sense: z.strictObject({ gloss: text(500), register: registerSchema.optional() }),
  form: z.strictObject({
    form: text(100),
    type: formTypeSchema,
    pos: posSchema.optional().meta({
      description: 'The part of speech the form inflects, such as auxiliary for "would" and verb for "willed".',
    }),
  }),
  relation: z.strictObject({ type: relationTypeSchema, target_sense_id: senseIdSchema }),
  pronunciation: z.strictObject({
    ipa: text(100),
    accent: accentSchema,
    strength: strengthSchema.optional().meta({ description: 'Absent means the strong (citation) form.' }),
    pos: posSchema
      .optional()
      .meta({ description: 'The part of speech this pronunciation belongs to, when it differs by POS.' }),
  }),
  example: z.strictObject({ text: text(500) }),
  translation: z.strictObject({
    language: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Z][A-Za-z]{1,3})?$/)
      .meta({ description: 'BCP 47 language tag, e.g. zh-Hans or fr.' }),
    text: text(200),
  }),
  topic: z.strictObject({
    topic_id: topicIdSchema.meta({ description: 'A leaf topic of the taxonomy (GET /v1/topics), never a category.' }),
  }),
  grammar: grammarPayloadSchema,
  morphology: morphologyPayloadSchema,
  collocation: z.strictObject({
    text: text(80).meta({ description: 'The combination with the word in it, such as "make a decision".' }),
    pattern: collocationPatternSchema,
  }),
  sense_list: senseListPayloadSchema,
}
export type FactPayloads = { [K in FactKind]: z.infer<(typeof factPayloadSchemas)[K]> }

// Stored facts predate some write rules, so reads parse the shape above and only submissions
// enforce the format rules.
const submitPayloadSchemas = {
  ...factPayloadSchemas,
  sense: factPayloadSchemas.sense.extend({ gloss: glossSchema }),
  pronunciation: factPayloadSchemas.pronunciation.extend({ ipa: ipaSchema }),
  grammar: grammarPayloadSchema
    .refine((grammar) => Object.keys(grammar).length > 0, 'A grammar fact names at least one property.')
    .refine(
      ({ patterns }) => !patterns || new Set(patterns).size === patterns.length,
      'Each grammar pattern is listed once.',
    ),
  morphology: morphologyPayloadSchema.superRefine(({ parts }, ctx) => {
    for (const message of morphologyIssues(parts)) ctx.addIssue({ code: 'custom', message })
  }),
  collocation: factPayloadSchemas.collocation.extend({
    text: text(80).refine((value) => /\s/.test(value), 'A collocation has at least two words.'),
  }),
  sense_list: senseListPayloadSchema.refine(
    ({ common, extra }) => new Set([...common, ...extra]).size === common.length + extra.length,
    'A sense list names each sense once, in common or in extra.',
  ),
}

export const factKindSchema = z
  .enum([
    'entry',
    'sense',
    'form',
    'relation',
    'pronunciation',
    'example',
    'translation',
    'topic',
    'grammar',
    'morphology',
    'collocation',
    'sense_list',
  ])
  .meta({ id: 'FactKind' })
export type FactKind = z.infer<typeof factKindSchema>

export const factStatusSchema = z
  .enum(['pending', 'published', 'rejected', 'superseded', 'retracted'])
  .meta({ id: 'FactStatus' })
export type FactStatus = z.infer<typeof factStatusSchema>

export const verdictSchema = z.enum(['pass', 'uncertain', 'fail']).meta({ id: 'Verdict' })
export type Verdict = z.infer<typeof verdictSchema>

export const reviewerKindSchema = z.enum(['jev', 'llm']).meta({ id: 'ReviewerKind' })
export type ReviewerKind = z.infer<typeof reviewerKindSchema>

export const reviewerChainSchema = z
  .enum(['jev', 'llm', 'jev+llm'])
  .meta({ id: 'ReviewerChain', description: 'The reviewers consulted, in order.' })
export type ReviewerChain = z.infer<typeof reviewerChainSchema>

export const reviewSchema = z
  .object({
    reviewer: reviewerChainSchema,
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

function submitVariant<K extends FactKind>(kind: K) {
  return z.object({
    kind: z.literal(kind),
    subject_id: z.uuid().meta({ description: 'Entry or sense the fact is about; the kind decides which.' }),
    supersedes_id: factIdSchema.optional().meta({ description: 'Published fact this one corrects.' }),
    payload: submitPayloadSchemas[kind],
  })
}

export const submitFactInputSchema = z
  .discriminatedUnion('kind', [
    submitVariant('entry'),
    submitVariant('sense'),
    submitVariant('form'),
    submitVariant('relation'),
    submitVariant('pronunciation'),
    submitVariant('example'),
    submitVariant('translation'),
    submitVariant('topic'),
    submitVariant('grammar'),
    submitVariant('morphology'),
    submitVariant('collocation'),
    submitVariant('sense_list'),
  ])
  .meta({ id: 'SubmitFactInput' })
export type SubmitFactInput = z.infer<typeof submitFactInputSchema>

function factVariant<K extends FactKind>(kind: K) {
  return z.object({
    id: factIdSchema,
    kind: z.literal(kind),
    subject_id: z.uuid(),
    object_id: senseIdSchema.nullable(),
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
    factVariant('entry'),
    factVariant('sense'),
    factVariant('form'),
    factVariant('relation'),
    factVariant('pronunciation'),
    factVariant('example'),
    factVariant('translation'),
    factVariant('topic'),
    factVariant('grammar'),
    factVariant('morphology'),
    factVariant('collocation'),
    factVariant('sense_list'),
  ])
  .meta({ id: 'Fact' })
export type FactDto = z.infer<typeof factSchema>

export const factWriteResultSchema = z
  .object({ fact: factSchema, created: z.boolean() })
  .meta({ id: 'FactWriteResult' })

export const factPageSchema = z
  .object({ items: z.array(factSchema), next_cursor: z.string().nullable() })
  .meta({ id: 'FactPage' })
