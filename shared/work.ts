import { z } from 'zod'
import { managedEntrySchema } from './catalog'
import {
  accentSchema,
  entryIdSchema,
  factIdSchema,
  factKindSchema,
  formTypeSchema,
  posSchema,
  relationTypeSchema,
  senseIdSchema,
} from './facts'

export const workLeaseIdSchema = z.uuid().brand<'WorkLeaseId'>()
export type WorkLeaseId = z.infer<typeof workLeaseIdSchema>

export const DEFAULT_LEASE_SECONDS = 900

export const claimWorkInputSchema = z
  .object({
    lease_seconds: z
      .number()
      .int()
      .min(60)
      .max(3600)
      .optional()
      .meta({ description: `How long the lease lasts. Defaults to ${DEFAULT_LEASE_SECONDS}.` }),
  })
  .meta({ id: 'ClaimWorkInput' })
export type ClaimWorkInput = z.infer<typeof claimWorkInputSchema>

export const workLeaseSchema = z
  .object({
    id: workLeaseIdSchema,
    entry_id: entryIdSchema,
    lemma: z.string(),
    holder: z.string(),
    expires_at: z.iso.datetime(),
  })
  .meta({ id: 'WorkLease' })

const senseGap = { sense_id: senseIdSchema }

const CLOSABLE =
  "When a learner's dictionary genuinely has nothing for this slot, submit a gap_closure fact naming this gap with the reason instead; review fails a closure of a slot that plainly applies."

const formSlotSchema = z.object({ type: formTypeSchema, pos: posSchema }).meta({ id: 'FormSlot' })

const relationHaveSchema = z
  .object({
    type: relationTypeSchema,
    direction: z.enum(['outgoing', 'incoming']).meta({
      description: 'outgoing: the sense is the subject (e.g. this IS-A target). incoming: the other sense is.',
    }),
  })
  .meta({ id: 'RelationHave' })

export const gapSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('senses') }).meta({ description: 'The entry has no sense with a live gloss.' }),
    z
      .object({
        type: z.literal('sense_list'),
        rejected: z.number().int().nonnegative().meta({
          description:
            'How many sense lists naming exactly the current senses review rejected, counted up to two. When it is above zero, read the review reason of the latest rejected sense_list in the entry facts and fix exactly what it names: add the missing senses, merge duplicates, reorder, or move senses between common and extra. A third rejection of the same senses no longer changes the gap, so the entry stalls until something else changes it.',
        }),
      })
      .meta({
        description:
          "The entry has senses but no live sense_list naming exactly them: none was submitted, it was rejected, or it is stale because a sense was added or a listed sense's gloss is no longer live. Complete the common senses, then submit a list (superseding a published one).",
      }),
    z
      .object({
        type: z.literal('forms'),
        missing: z.array(formSlotSchema).meta({
          description:
            'Each inflection the paradigm needs and no live form fills, by type and the part of speech it inflects.',
        }),
      })
      .meta({
        description: `The paradigm of a single word lacks inflections: a verb needs its third_person_singular, past, past_participle, and present_participle; a noun with a countable sense its plural; an adjective that compares with -er and -est (one syllable, two ending in y, or one already recorded) its comparative and superlative, and so does an adverb with one recorded. A form fills a slot when it is labelled with that part of speech, or unlabelled and shown under it. Periphrastic comparisons (more beautiful) are never forms. ${CLOSABLE}`,
      }),
    z
      .object({
        type: z.literal('pronunciation'),
        accents: z.array(accentSchema).meta({ description: 'The accents with no live strong pronunciation.' }),
      })
      .meta({ description: 'The entry needs a strong (citation) pronunciation in both us and uk.' }),
    z
      .object({
        type: z.literal('phrases'),
        have: z.array(z.string()).meta({
          description: 'The live phrases headed by the word that already count, in lemma order.',
        }),
        need: z.number().int().positive().meta({ description: 'How many headed phrases the verb needs: three.' }),
      })
      .meta({
        description: `A core verb (a single word a CEFR learner list names as an A1 or A2 verb) has fewer than three live phrasal verbs or verb idioms headed by it: multiword entries whose first word is the verb and that have a live verb sense ("give up", "give way"). A phrase that only contains the word ("ordinary share") or is not a verb ("help desk") does not count. Add only phrases a learner's dictionary (Oxford Advanced Learner's, Longman, Cambridge) prints; never coin one to fill the gap ("telephone in", "party down"): the entry review fails it. Create each phrase as its own entry (POST /manage/v1/entries) with its entry fact, a verb sense with its gloss, and the facts a phrase needs; the head's gap updates once the phrase entry and its verb sense are live. When fewer than three common phrasal verbs or verb idioms exist, create the ones that do and submit a gap_closure naming this gap whose reason names them; review fails it when a common one is missing.`,
      }),
    z.object({ type: z.literal('family') }).meta({
      description: `An A1 or A2 single word has no live word-family member: no live entry has a live morphology fact with a base part whose lemma is this word. Find the common derivatives a learner's dictionary lists with it (happy: happiness, happily, unhappy; study: student, studious). For each, create the derivative's entry if it is missing (POST /manage/v1/entries with its entry fact and senses), then submit its morphology with the base part naming this word as its lemma ({"form": "study", "role": "base", "lemma": "study"}), or correct its published morphology to add the lemma. ${CLOSABLE}`,
    }),
    z
      .object({ type: z.literal('morphology') })
      .meta({ description: 'A single-word entry has no live word formation.' }),
    z
      .object({ type: z.literal('syllables') })
      .meta({ description: 'A single-word entry has no live syllable division.' }),
    z
      .object({
        type: z.literal('form_pronunciations'),
        forms: z.array(z.string()).meta({ description: 'The irregular forms with no live pronunciation.' }),
      })
      .meta({
        description:
          'An irregular inflection (one no regular spelling rule gives, such as "went") has no live pronunciation: submit a correction of the form that adds ipa and accent.',
      }),
    z
      .object({
        type: z.literal('relations'),
        ...senseGap,
        count: z.number().int().nonnegative().meta({
          description:
            'Live relations the sense is in, as subject or object. The gap stays open below what its part of speech needs: two for nouns, verbs, and adjectives, one for adverbs and pronouns; other parts of speech have no relations gap.',
        }),
        have: z.array(relationHaveSchema).meta({
          description:
            'Each relation type and direction the sense already has, once, so an agent looks for the others.',
        }),
      })
      .meta({ description: CLOSABLE }),
    z
      .object({
        type: z.literal('examples'),
        ...senseGap,
        count: z.number().int().nonnegative().meta({ description: 'Live examples of the sense.' }),
        need: z.number().int().positive().meta({
          description: 'Examples the sense needs: two for an entry at CEFR A1 or A2, else one.',
        }),
      })
      .meta({ description: 'The sense has fewer live examples than it needs.' }),
    z.object({ type: z.literal('translations'), ...senseGap, language: z.literal('zh') }),
    z
      .object({
        type: z.literal('example_translations'),
        ...senseGap,
        language: z.literal('zh'),
        examples: z.array(factIdSchema).meta({
          description: 'The live examples of the sense with no translation in the language.',
        }),
      })
      .meta({
        description:
          'Every live example of the sense needs a translation in the language: submit a correction of each example named that adds it (supersedes_id set to the example).',
      }),
    z.object({ type: z.literal('topics'), ...senseGap }).meta({
      description: `The sense has no live topic fact. Nouns and verbs need one; other parts of speech have no topics gap. ${CLOSABLE}`,
    }),
    z.object({ type: z.literal('grammar'), ...senseGap }).meta({
      description: `A noun, verb, adjective, adverb, determiner, or pronoun sense has no live grammar fact: countability for a noun, transitivity for a verb, position, patterns, or prepositions for an adjective, the usual position (front, mid, end) or prepositions for an adverb, and agreement for a determiner or pronoun (singular_noun, plural_noun, uncountable_noun, of_plural, singular_verb, plural_verb). ${CLOSABLE}`,
    }),
    z.object({ type: z.literal('collocations'), ...senseGap }).meta({
      description: `A noun, verb, adjective, adverb, determiner, preposition, or conjunction sense has no live collocation: a combination native speakers commonly use with the word in this sense ("make a decision", "work hard", "hardly any", "filled with", "both ... and"). ${CLOSABLE}`,
    }),
  ])
  .meta({ id: 'Gap', description: 'Something the entry has too few live (pending or published) facts for.' })
export type Gap = z.infer<typeof gapSchema>

export const weakFactSchema = z
  .object({
    id: factIdSchema,
    kind: factKindSchema,
    reason: z.enum(['feedback', 'uncertain', 'failed']).meta({
      description:
        'feedback: an open or claimed feedback item targets the fact. uncertain: the fact published on an uncertain review verdict. failed: the fact stays published although a review in place failed it (a gloss that lacks the region or register label its sense needs); read the review reason and submit a correction that supersedes it.',
    }),
  })
  .meta({
    id: 'WeakFact',
    description: 'A live fact of the entry worth replacing: submit a correction that supersedes it, or retract it.',
  })
export type WeakFact = z.infer<typeof weakFactSchema>

export const workClaimSchema = z
  .object({
    lease: workLeaseSchema,
    entry: managedEntrySchema,
    gaps: z.array(gapSchema),
    weak_facts: z.array(weakFactSchema),
  })
  .meta({ id: 'WorkClaim' })

export const completeWorkInputSchema = z
  .object({ note: z.string().trim().min(1).max(500).optional() })
  .meta({ id: 'CompleteWorkInput' })
export type CompleteWorkInput = z.infer<typeof completeWorkInputSchema>

export const workCompletionSchema = z
  .object({ entry_id: entryIdSchema, last_worked_at: z.iso.datetime() })
  .meta({ id: 'WorkCompletion' })

/**
 * At most this many rows per rescore call. A rescore costs three D1 calls (the entry, its snapshot
 * batch, the conditional save), so one request stays inside the Worker's per-invocation budget.
 */
export const WORK_RESCORE_MAX = 200

export const workRescoreInputSchema = z
  .object({
    limit: z.number().int().min(1).max(WORK_RESCORE_MAX).default(100).meta({
      description: 'The most stale worklist rows this call rescores.',
    }),
  })
  .meta({ id: 'WorkRescoreInput' })
export type WorkRescoreInput = z.infer<typeof workRescoreInputSchema>

export const workRescoreResultSchema = z
  .object({
    rescored: z.number().int().nonnegative().meta({ description: 'Rows this call rescored.' }),
    remaining: z.number().int().nonnegative().meta({ description: 'Rows still stale; 0 when done.' }),
  })
  .meta({ id: 'WorkRescoreResult' })
export type WorkRescoreResult = z.infer<typeof workRescoreResultSchema>
