import { z } from 'zod'
import { managedEntrySchema } from './catalog'
import {
  accentSchema,
  entryIdSchema,
  factIdSchema,
  factKindSchema,
  factSchema,
  formTypeSchema,
  posSchema,
  regionSchema,
  registerSchema,
  senseIdSchema,
} from './facts'
import { cefrLevelSchema } from './reference'

export const workLeaseIdSchema = z.uuid().brand<'WorkLeaseId'>()
export type WorkLeaseId = z.infer<typeof workLeaseIdSchema>

export const workItemIdSchema = z.uuid().brand<'WorkItemId'>()
export type WorkItemId = z.infer<typeof workItemIdSchema>

export const DEFAULT_LEASE_SECONDS = 900

/** The most items one claim leases, so building their context stays inside one request's budget. */
export const MAX_CLAIM_ITEMS = 50
export const DEFAULT_CLAIM_ITEMS = 10

const senseGap = { sense_id: senseIdSchema }

const CLOSABLE =
  "When a learner's dictionary genuinely has nothing for this slot, submit a gap_closure fact naming this gap with the reason instead; review fails a closure of a slot that plainly applies."

const formSlotSchema = z.object({ type: formTypeSchema, pos: posSchema }).meta({ id: 'FormSlot' })

export const gapSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('senses') }).meta({
      description:
        "The entry has no sense with a live gloss. Create every common sense a learner's dictionary gives the word (POST /manage/v1/senses), then its sense list.",
    }),
    z
      .object({
        type: z.literal('sense_list'),
        senses: z.array(senseIdSchema).meta({
          description:
            'The senses with a live gloss, oldest first: the list names each exactly once, in common or in extra.',
        }),
      })
      .meta({
        description:
          "The entry has senses but no live sense_list naming exactly them: none was submitted, it was rejected, or it is stale because a sense was added or a listed sense's gloss is no longer live. Complete the common senses, then submit a list (superseding a published one). Read the review reason of any rejected sense_list among the entry's facts and fix exactly what it names.",
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
    z.object({ type: z.literal('category'), ...senseGap }).meta({
      description: `A noun sense has no live everyday hypernym: no broader term a learner files it under. Submit a hypernym relation (no domain) from this sense to each category word a learner's dictionary uses for it: "dog" to animal and to pet, "eagle" to bird, "stroll" to walk. Every target is a real headword; never a technical taxon ("canine", "passerine"), which goes in a domain layer (domain: "biology"). Narrower terms are never needed on the category word: its members are the words that name it as their category. ${CLOSABLE}`,
    }),
    z.object({ type: z.literal('parts'), ...senseGap }).meta({
      description: `A noun sense with an everyday category has no live part attached to it: no live part_of relation names this sense as the whole. Submit, in one pass, a part_of relation from each main part a learner's dictionary names for this thing to this sense ("beak", "wing", "feather" to "bird"; "wheel", "engine" to "car"). A part attaches to the most general common whole it belongs to: a tail to "animal", not to "dog". ${CLOSABLE}`,
    }),
    z.object({ type: z.literal('synonyms'), ...senseGap }).meta({
      description: `A content-word sense has no live synonym or antonym. Submit the synonyms and antonyms a learner can use in this sense ("big": large; small). ${CLOSABLE}`,
    }),
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
    z
      .object({
        type: z.literal('weak_fact'),
        fact_id: factIdSchema,
        kind: factKindSchema,
        reason: z.enum(['feedback', 'uncertain', 'failed']).meta({
          description:
            'feedback: an open or claimed feedback item targets the fact. uncertain: the fact published on an uncertain review verdict. failed: the fact stays published although a review in place failed it (a gloss that lacks the region or register label its sense needs).',
        }),
      })
      .meta({
        description:
          'A live fact worth replacing: read its review reason (in the context facts) and submit a correction that supersedes it, or retract it.',
      }),
  ])
  .meta({
    id: 'Gap',
    description:
      'One piece of open work: a slot the entry has too few live (pending or published) facts for, or a weak fact.',
  })
export type Gap = z.infer<typeof gapSchema>

export const workTypeSchema = z
  .enum(gapSchema.options.map((option) => option.shape.type.value) as [Gap['type'], ...Gap['type'][]])
  .meta({ id: 'WorkType', description: 'The type of a work item: the gap it is, or weak_fact.' })
export type WorkType = z.infer<typeof workTypeSchema>

export type WeakFact = Extract<Gap, { type: 'weak_fact' }>

export const claimWorkInputSchema = z
  .object({
    types: z
      .array(workTypeSchema)
      .min(1)
      .refine((types) => new Set(types).size === types.length, 'Each type is listed once.')
      .optional()
      .meta({ description: 'Lease only items of these types; absent means any type.' }),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_CLAIM_ITEMS)
      .default(DEFAULT_CLAIM_ITEMS)
      .meta({ description: `The most items to lease, all of one type. Defaults to ${DEFAULT_CLAIM_ITEMS}.` }),
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
    type: workTypeSchema,
    holder: z.string(),
    expires_at: z.iso.datetime(),
  })
  .meta({ id: 'WorkLease' })

const contextSenseSchema = z
  .object({
    id: senseIdSchema,
    pos: posSchema,
    gloss: z.string(),
    register: registerSchema.nullable(),
    region: regionSchema.nullable(),
    rare: z.boolean().meta({ description: "In the extra senses of the entry's current sense list." }),
    status: z.enum(['pending', 'published']).meta({ description: 'The status of the gloss.' }),
  })
  .meta({ id: 'WorkSense' })

const relatedSenseSchema = z
  .object({ sense_id: senseIdSchema, lemma: z.string(), pos: posSchema, gloss: z.string().nullable() })
  .meta({ id: 'WorkRelatedSense', description: 'A sense at the other end of a relation among the context facts.' })

export const workContextSchema = z
  .object({
    entry: z
      .object({
        id: entryIdSchema,
        lemma: z.string(),
        cefr: z.array(z.object({ pos: posSchema, level: cefrLevelSchema })),
        zipf: z.number().nullable(),
        senses: z.array(contextSenseSchema).meta({
          description: 'The senses with a live gloss, common senses first in the order of the current sense list.',
        }),
      })
      .meta({ description: 'The entry the item belongs to.' }),
    sense: contextSenseSchema.nullable().meta({ description: 'The sense the item is about; null for an entry item.' }),
    facts: z.array(factSchema).meta({
      description:
        "Every fact about the item's node, in every status with its review: an entry's own facts, or a sense's facts and the relations pointing at it. For a weak fact, the node the fact is about.",
    }),
    related: z.array(relatedSenseSchema),
    view: managedEntrySchema.nullable().meta({
      description:
        'The whole management view of the entry, for the types that need every sense and fact at once (senses, sense_list, phrases, family); null for the others.',
    }),
  })
  .meta({ id: 'WorkContext' })

export const workItemSchema = z
  .object({
    id: workItemIdSchema,
    type: workTypeSchema,
    entry_id: entryIdSchema,
    lemma: z.string(),
    subject_id: z.uuid().meta({ description: 'The node the item is about: the entry, a sense, or the weak fact.' }),
    stage: z.number().int().positive().meta({
      description: '1 identity, 2 meaning, 3 usage, 4 network, 5 weak facts: the priority policy stage of the type.',
    }),
    attempts: z.number().int().nonnegative().meta({
      description:
        'Completed passes that left this gap as their claim found it. At three the item leaves the production queue for curators.',
    }),
    gap: gapSchema,
  })
  .meta({ id: 'WorkItem' })

export const claimedWorkItemSchema = workItemSchema
  .extend({ context: workContextSchema })
  .meta({ id: 'ClaimedWorkItem' })

export const workClaimSchema = z
  .object({ lease: workLeaseSchema, items: z.array(claimedWorkItemSchema) })
  .meta({ id: 'WorkClaim' })

export const completeWorkInputSchema = z
  .object({
    items: z
      .array(
        z.object({
          id: workItemIdSchema,
          note: z.string().trim().min(1).max(500).optional(),
        }),
      )
      .max(MAX_CLAIM_ITEMS)
      .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Each item is listed once.')
      .meta({
        description:
          'The leased items this pass worked. Each is judged against the gap its claim found: unchanged once its reviews settle, it counts an attempt. Leased items left out are released without one.',
      }),
  })
  .meta({ id: 'CompleteWorkInput' })
export type CompleteWorkInput = z.infer<typeof completeWorkInputSchema>

export const workItemStateSchema = z.enum(['closed', 'open', 'awaiting_review', 'curation']).meta({
  id: 'WorkItemState',
  description:
    'closed: the gap is gone. open: back in the production queue. awaiting_review: facts that may fill it are pending, so it waits for their verdicts before it is judged. curation: three passes left it unchanged, so it waits for a curator.',
})
export type WorkItemState = z.infer<typeof workItemStateSchema>

export const workCompletionSchema = z
  .object({
    lease_id: workLeaseIdSchema,
    items: z.array(
      z.object({
        id: workItemIdSchema,
        state: workItemStateSchema,
        attempts: z.number().int().nonnegative(),
      }),
    ),
  })
  .meta({ id: 'WorkCompletion' })

export const curationItemSchema = workItemSchema
  .extend({
    last_worked_at: z.iso.datetime().nullable(),
    last_worked_by: z.string().nullable(),
    last_note: z.string().nullable(),
  })
  .meta({ id: 'CurationItem' })

export const curationPageSchema = z
  .object({ items: z.array(curationItemSchema), next_cursor: z.string().nullable() })
  .meta({ id: 'CurationPage' })

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
