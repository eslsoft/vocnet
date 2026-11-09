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
}
export type FactPayloads = { [K in FactKind]: z.infer<(typeof factPayloadSchemas)[K]> }

// Stored facts predate some write rules, so reads parse the shape above and only submissions
// enforce the format rules.
const submitPayloadSchemas = {
  ...factPayloadSchemas,
  sense: factPayloadSchemas.sense.extend({ gloss: glossSchema }),
  pronunciation: factPayloadSchemas.pronunciation.extend({ ipa: ipaSchema }),
}

export const factKindSchema = z
  .enum(['entry', 'sense', 'form', 'relation', 'pronunciation', 'example', 'translation'])
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
  ])
  .meta({ id: 'Fact' })
export type FactDto = z.infer<typeof factSchema>

export const factWriteResultSchema = z
  .object({ fact: factSchema, created: z.boolean() })
  .meta({ id: 'FactWriteResult' })

export const factPageSchema = z
  .object({ items: z.array(factSchema), next_cursor: z.string().nullable() })
  .meta({ id: 'FactPage' })
