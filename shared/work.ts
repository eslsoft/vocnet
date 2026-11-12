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
  servedLanguageSchema,
  translatedSchema,
} from './facts'
import { cefrLevelSchema } from './reference'

export const workLeaseIdSchema = z.uuid().brand<'WorkLeaseId'>()
export type WorkLeaseId = z.infer<typeof workLeaseIdSchema>

export const workItemIdSchema = z.uuid().brand<'WorkItemId'>()
export type WorkItemId = z.infer<typeof workItemIdSchema>

export const DEFAULT_LEASE_SECONDS = 900

/** How many passes an item gets: the first, and one retry that sees the review reasons. */
export const MAX_PASSES = 2

/** The most items one claim leases, so building their context stays inside one request's budget. */
export const MAX_CLAIM_ITEMS = 50
export const DEFAULT_CLAIM_ITEMS = 10

const senseGap = { sense_id: senseIdSchema }

/** An optional slot is complete after one honest pass, which states what it considered when it finds nothing. */
const OPTIONAL =
  'This slot is optional: submit every value a learner\'s dictionary gives. When none fits, complete the item with a note naming what you considered and why none fits, and list in blocked_on any fitting word that is not an entry yet or has no published sense inventory; the item reopens once such a word goes live.'

const formSlotSchema = z.object({ type: formTypeSchema, pos: posSchema }).meta({ id: 'FormSlot' })

const translationTargetSchema = z
  .object({
    of: translatedSchema,
    id: z.uuid().meta({ description: 'The sense id, or the example or collocation fact id.' }),
  })
  .meta({ id: 'TranslationTarget' })

export const gapSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('senses') }).meta({
      description:
        "The entry has no live sense inventory. Submit one senses fact listing every sense a learner's dictionary gives the word, common senses first, keeping the id of each existing sense you keep. Once it publishes, its senses are fixed.",
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
        description:
          'The paradigm of a single word lacks inflections: a verb needs its third_person_singular, past, past_participle, and present_participle; a noun with a countable sense its plural; an adjective that compares with -er and -est (one syllable, two ending in y, or one already recorded) its comparative and superlative, and so does an adverb with one recorded. A form fills a slot when it is labelled with that part of speech, or unlabelled and shown under it. Periphrastic comparisons (more beautiful) are never forms.',
      }),
    z
      .object({
        type: z.literal('pronunciation'),
        accents: z.array(accentSchema).meta({ description: 'The accents with no live strong pronunciation.' }),
      })
      .meta({ description: 'The entry needs a strong (citation) pronunciation in both us and uk.' }),
    z.object({ type: z.literal('phrases') }).meta({
      description: `The headword has no live phrases list. Submit one phrases fact listing every phrase of the headword that a learner's dictionary (Oxford Advanced Learner's, Longman, Cambridge) prints as its phrase, phrasal verb, or idiom, or whose meaning is not the sum of its words ("give up", "in front of"); never coin one, and never list a plain description built from the words' ordinary meanings ("white rice"). There is no limit on how many. Each listed phrase becomes an entry of its own once the list publishes. ${OPTIONAL}`,
    }),
    z.object({ type: z.literal('family') }).meta({
      description: `An A1 or A2 single word has no live word-family member: no live entry has a live morphology fact with a base part whose lemma is this word. Its common derivatives a learner's dictionary lists with it (happy: happiness, happily, unhappy; study: student, studious) that are entries get a morphology whose base part names this word as its lemma ({"form": "study", "role": "base", "lemma": "study"}). ${OPTIONAL}`,
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
      description: `A core noun sense has no live everyday hypernym: no broader term a learner files it under. Submit a hypernym relation (no domain) from this sense to each category word a learner's dictionary uses for it: "dog" to animal and to pet, "eagle" to bird, "stroll" to walk. Every target is a real headword; never a technical taxon ("canine", "passerine"), which goes in a domain layer (domain: "biology"). ${OPTIONAL}`,
    }),
    z.object({ type: z.literal('parts'), ...senseGap }).meta({
      description: `A core noun sense with an everyday category has no live part attached to it. Submit a part_of relation from each main part a learner's dictionary names for this thing to this sense ("beak", "wing", "feather" to "bird"; "wheel", "engine" to "car"). A part attaches to the most general common whole it belongs to: a tail to "animal", not to "dog". ${OPTIONAL}`,
    }),
    z.object({ type: z.literal('synonyms'), ...senseGap }).meta({
      description: `A core content-word sense has no live synonym or antonym. Submit the synonyms and antonyms a learner can use in this sense ("big": large; small). ${OPTIONAL}`,
    }),
    z
      .object({
        type: z.literal('examples'),
        ...senseGap,
        count: z.number().int().nonnegative().meta({ description: 'Live examples of the sense.' }),
        need: z.number().int().positive().meta({
          description: 'Examples the sense needs: two for a core sense of an entry at CEFR A1 or A2, else one.',
        }),
      })
      .meta({ description: 'The sense has fewer live examples than it needs.' }),
    z
      .object({
        type: z.literal('translations'),
        language: servedLanguageSchema,
        missing: z.array(translationTargetSchema).meta({
          description: 'Each live sense, example, and collocation of the entry with no live translation in the language.',
        }),
      })
      .meta({
        description:
          'Translate every listed item of the entry into the language, one translation fact each (of: what it translates; subject_id: the sense id or the example or collocation fact id). The context view carries every sense, example, and collocation with its text.',
      }),
    z.object({ type: z.literal('topics'), ...senseGap }).meta({
      description: `The core sense has no live topic fact. Core nouns and verbs have a topics slot; tag only a leaf topic of the taxonomy (GET /v1/topics). ${OPTIONAL}`,
    }),
    z.object({ type: z.literal('grammar'), ...senseGap }).meta({
      description: `A noun, verb, adjective, adverb, determiner, or pronoun sense has no live grammar fact: countability for a noun, transitivity for a verb, position, patterns, or prepositions for an adjective, the usual position (front, mid, end) or prepositions for an adverb, and agreement for a determiner or pronoun. ${OPTIONAL}`,
    }),
    z.object({ type: z.literal('collocations'), ...senseGap }).meta({
      description: `A core noun, verb, adjective, adverb, determiner, preposition, or conjunction sense has no live collocation: a combination native speakers commonly use with the word in this sense ("make a decision", "work hard", "both ... and"). ${OPTIONAL}`,
    }),
  ])
  .meta({
    id: 'Gap',
    description: 'One piece of open work: a slot the entry has too few live (pending or published) facts for.',
  })
export type Gap = z.infer<typeof gapSchema>

export const workTypeSchema = z
  .enum(gapSchema.options.map((option) => option.shape.type.value) as [Gap['type'], ...Gap['type'][]])
  .meta({ id: 'WorkType', description: 'The type of a work item: the gap it is.' })
export type WorkType = z.infer<typeof workTypeSchema>

/** The optional slots: one honest pass completes them, whether or not it finds a value. */
export const OPTIONAL_GAPS = ['phrases', 'family', 'category', 'parts', 'synonyms', 'topics', 'grammar', 'collocations'] as const satisfies readonly WorkType[]
export type OptionalGap = (typeof OPTIONAL_GAPS)[number]
export const isOptionalGap = (type: WorkType): type is OptionalGap => (OPTIONAL_GAPS as readonly WorkType[]).includes(type)

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
    rare: z.boolean().meta({ description: "Ranked extra in the entry's inventory." }),
    status: z.enum(['pending', 'published']).meta({ description: 'The status of the inventory that lists it.' }),
  })
  .meta({ id: 'WorkSense' })

const relatedSenseSchema = z
  .object({
    sense_id: senseIdSchema,
    lemma: z.string(),
    pos: posSchema,
    gloss: z.string().nullable().meta({
      description:
        'Its current gloss while the sense can show (a live gloss and a live entry fact); null when it cannot, and a relation to it then fills nothing.',
    }),
  })
  .meta({ id: 'WorkRelatedSense', description: 'A sense at the other end of a relation among the context facts.' })

const fillCriteriaSchema = z
  .object({
    kind: factKindSchema,
    claim: z.string().meta({ description: 'What the judged fact claims, such as "relation synonym".' }),
    jev: z
      .object({
        questions: z
          .array(z.string())
          .meta({ description: 'The questions Jev scores from 0 to 1, as Jev receives them.' }),
        rule: z.string().meta({ description: "How Jev's scores decide the fact, and when the LLM rubric does." }),
      })
      .nullable()
      .meta({ description: 'Null when the LLM judges the kind alone.' }),
    rubric: z.string().meta({
      description: "The LLM reviewer's prompt for the fact, with the item's values as <placeholders>.",
    }),
    limits: z.array(z.string()).meta({ description: 'The write rules the submission must meet before review.' }),
  })
  .meta({ id: 'WorkFillCriteria', description: 'How one kind of fact that fills the item is judged.' })

export const workCriteriaSchema = z
  .object({
    fills: z.array(fillCriteriaSchema).meta({
      description: "Each kind of fact that fills the item's gap, with the review that judges it.",
    }),
    limits: z.array(z.string()).meta({ description: 'The write rules every submission meets.' }),
  })
  .meta({
    id: 'WorkCriteria',
    description:
      'The standard the reviewers apply to the facts that fill this item: the same prompts their reviews receive, rendered for placeholder values. Work to the standard, not to its wording: a value that echoes it without the facts behind it fails.',
  })

export const workContextSchema = z
  .object({
    entry: z
      .object({
        id: entryIdSchema,
        lemma: z.string(),
        cefr: z.array(z.object({ pos: posSchema, level: cefrLevelSchema })),
        zipf: z.number().nullable(),
        senses: z.array(contextSenseSchema).meta({
          description: 'The senses of the live inventory, in its order: common senses first.',
        }),
      })
      .meta({ description: 'The entry the item belongs to.' }),
    sense: contextSenseSchema.nullable().meta({ description: 'The sense the item is about; null for an entry item.' }),
    facts: z.array(factSchema).meta({
      description:
        "Every fact about the item's node, in every status with its review: an entry's own facts, or a sense's facts and the relations pointing at it.",
    }),
    rejections: z.array(factSchema).meta({
      description:
        'The facts earlier passes at this item submitted that review rejected, with their reviews: address each reason, and never resubmit rejected content.',
    }),
    related: z.array(relatedSenseSchema),
    view: managedEntrySchema.nullable().meta({
      description:
        'The whole management view of the entry, for the types that need every sense and fact at once (senses, phrases, family, translations); null for the others.',
    }),
    criteria: workCriteriaSchema,
  })
  .meta({ id: 'WorkContext' })

export const workItemSchema = z
  .object({
    id: workItemIdSchema,
    type: workTypeSchema,
    entry_id: entryIdSchema,
    lemma: z.string(),
    subject_id: z.uuid().meta({ description: 'The node the item is about: the entry or a sense.' }),
    stage: z.number().int().positive().meta({
      description: '1 identity, 2 meaning, 3 usage, 4 network: the priority policy stage of the type.',
    }),
    attempts: z.number().int().nonnegative().meta({
      description: `Completed passes that did not fill the gap. At ${MAX_PASSES} the item leaves the production queue as a ticket for a curator.`,
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

/** The longest note a pass leaves. */
export const PASS_NOTE_MAX = 500

export const completeWorkInputSchema = z
  .object({
    items: z
      .array(
        z.object({
          id: workItemIdSchema,
          note: z.string().trim().min(1).max(PASS_NOTE_MAX).optional().meta({
            description:
              'What the pass did. Required for an optional slot completed without a value: what was considered and why none fits.',
          }),
          blocked_on: z
            .array(z.string().trim().min(1).max(100))
            .max(20)
            .optional()
            .meta({
              description:
                'Optional slots only: lemmas that would fill the slot but are not live entries or have no published inventory yet. The item reopens when one goes live.',
            }),
        }),
      )
      .max(MAX_CLAIM_ITEMS)
      .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Each item is listed once.')
      .meta({
        description:
          'The leased items this pass worked. Each is judged once its reviews settle: a pass that did not fill a required gap counts an attempt; an optional slot is complete after one pass. Leased items left out are released without one.',
      }),
  })
  .meta({ id: 'CompleteWorkInput' })
export type CompleteWorkInput = z.infer<typeof completeWorkInputSchema>

export const workItemStateSchema = z.enum(['closed', 'open', 'awaiting_review', 'ticket']).meta({
  id: 'WorkItemState',
  description: `closed: the gap is gone, or an optional slot had its pass. open: back in the production queue. awaiting_review: facts that may fill it are pending, so it waits for their verdicts before it is judged. ticket: ${MAX_PASSES} passes did not fill it, so a curator handles it.`,
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
