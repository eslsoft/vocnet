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

const text = (max: number) => z.string().trim().min(1).max(max)

export const factPayloadSchemas = {
  entry: z.strictObject({}),
  sense: z.strictObject({ gloss: text(500) }),
  form: z.strictObject({ form: text(100), type: formTypeSchema }),
  relation: z.strictObject({ type: relationTypeSchema, target_sense_id: senseIdSchema }),
  pronunciation: z.strictObject({ ipa: text(100), accent: accentSchema }),
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

export const reviewSchema = z
  .object({
    reviewer: reviewerKindSchema,
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
    payload: factPayloadSchemas[kind],
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
