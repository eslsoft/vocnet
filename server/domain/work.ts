import {
  accentSchema,
  type EntryId,
  type FactStatus,
  type FormType,
  type Pos,
  SERVED_LANGUAGES,
  type SenseId,
  type ServedLanguage,
  type Translated,
} from '@shared/facts'
import { type Gap, isOptionalGap, MAX_PASSES, type WorkItemId, type WorkLeaseId, type WorkType } from '@shared/work'
import { factCredibility, passCredibility } from './credibility'
import { type Fact, type FactOf, isKind } from './fact'
import { formMeaning, isIrregularForm, isPeriphrastic } from './fact-kinds'
import { isLive } from './fact-lifecycle'
import { currentInventory, inventorySenses } from './inventory'
import type { PrincipalRef } from './principal'
import { isMultiword } from './term'

/** What the work rules read about an entry: its facts in every status and the passes its optional slots had. */
export interface EntryFacts {
  /** `live`: an imported headword, or a phrase a published phrases list names. */
  entry: { id: EntryId; lemma: string; live: boolean }
  /** The entry's learner level: 1 for A1 to 6 for C2 (`levelRank`); null without a CEFR level. */
  levelRank: number | null
  /**
   * The lemmas of the other live entries with a live morphology fact whose base part names this
   * lemma: its word family.
   */
  family: readonly string[]
  /** Facts whose subject is the entry, one of its senses, or (translations) one of their facts. */
  facts: Fact[]
  /** Relation facts whose object is one of the entry's senses. */
  incoming: Fact[]
  /**
   * The slots a pass completed without a value, keyed `type|subject` (`passKey`): an optional slot
   * a worker found nothing for, or any slot a curator settled by hand.
   */
  passes: ReadonlySet<string>
  /**
   * Senses at the other end of the entry's relations: the inventories of their entries, and the
   * entries among them that are live.
   */
  neighbors: { inventories: Fact[]; liveEntries: ReadonlySet<EntryId> }
}

type GapInput = Pick<EntryFacts, 'entry' | 'levelRank' | 'family' | 'facts' | 'incoming' | 'passes' | 'neighbors'>

/** The key of an optional slot's completed pass. */
export const passKey = (type: WorkType, subjectId: string) => `${type}|${subjectId}`

/** A sense the per-sense rules count: a common sense of the counted inventory. */
interface CountedSense {
  id: SenseId
  pos: Pos
}

/** Which fact statuses a computation counts: the live ones, or only the published (settled) ones. */
type Counts = (status: FactStatus) => boolean
const isSettled: Counts = (status) => status === 'published'

/** A claim of up to `limit` items of one type, held by one principal until it completes or expires. */
export interface WorkLease {
  id: WorkLeaseId
  holder: PrincipalRef
  type: WorkType
  /** The entries of the items it leased, rescored when it completes. */
  entryIds: readonly EntryId[]
  /** The items it leased; one closed by the pass's own facts is gone by the time it completes. */
  itemIds: readonly WorkItemId[]
  claimedAt: string
  expiresAt: string
}

export function leaseExpiry(now: Date, leaseSeconds: number): string {
  return new Date(now.getTime() + leaseSeconds * 1000).toISOString()
}

/** Only the holder completes its lease, and only before it expires. */
export function completeDecision(
  lease: Pick<WorkLease, 'holder' | 'expiresAt'>,
  who: PrincipalRef,
  now: Date,
): 'allowed' | 'not_holder' | 'expired' {
  if (lease.holder !== who) return 'not_holder'
  return Date.parse(lease.expiresAt) <= now.getTime() ? 'expired' : 'allowed'
}

type EntryGap = Extract<
  Gap,
  {
    type:
      | 'senses'
      | 'forms'
      | 'pronunciation'
      | 'phrases'
      | 'family'
      | 'morphology'
      | 'syllables'
      | 'form_pronunciations'
      | 'translations'
  }
>
type SenseGap = Exclude<Gap, EntryGap>

/** A live inflection with the part of speech it fills: its label, else the meaning the entry shows it under. */
interface Inflection {
  type: FormType
  pos: Pos | undefined
}

/**
 * What the gap rules read: the entry's facts in every status, the counted ones (live, or only
 * published for the settled view), the senses whose gloss is counted, the counted ones among them,
 * and the entry's counted inflections.
 */
interface EntryState {
  entryId: EntryId
  lemma: string
  /** The entry is at CEFR A1 or A2, where a learner needs more of each sense. */
  elementary: boolean
  family: readonly string[]
  facts: readonly Fact[]
  live: Fact[]
  /** Whether the entry has a counted inventory. */
  inventoried: boolean
  counted: CountedSense[]
  /** The core senses among the counted ones, which need every per-sense slot (`coreSenses`). */
  core: ReadonlySet<SenseId>
  inflections: Inflection[]
  /** The neighbor senses a relation may link to and count. */
  visible: ReadonlySet<string>
  passes: ReadonlySet<string>
}

const counting =
  (kind: Fact['kind']) =>
  ({ live }: EntryState) =>
    live.filter((fact) => fact.kind === kind).length

/** The live fact of a `one` kind that no live correction supersedes, so a pending correction stands for its original. */
function currentOf<K extends Fact['kind']>(live: readonly Fact[], kind: K): FactOf<K> | null {
  const facts = live.filter((fact): fact is FactOf<K> & Fact => fact.kind === kind)
  return facts.find((fact) => !facts.some((other) => other.supersedesId === fact.id)) ?? null
}

/** The entry's live inflections, periphrastic comparisons left out, each with the part of speech it fills. */
function inflectionsOf(live: readonly Fact[], counted: readonly CountedSense[]): Inflection[] {
  return live
    .filter(isKind('form'))
    .filter(({ payload: { type, form } }) => type !== 'variant' && !isPeriphrastic(type, form))
    .map(({ payload: { type, pos } }) => ({ type, pos: pos ?? formMeaning(type, undefined, counted)?.pos }))
}

export const VERB_PARADIGM: readonly FormType[] = [
  'third_person_singular',
  'past',
  'past_participle',
  'present_participle',
]
const COMPARISON: readonly FormType[] = ['comparative', 'superlative']

/**
 * A word compares with -er and -est in this part of speech: an inflected comparison of it is
 * recorded, or it is an adjective of one syllable, or of two ending in y ("happy"), by its live
 * syllables. Longer adjectives compare with more and most, which is no form.
 */
function compares(state: EntryState, pos: 'adjective' | 'adverb'): boolean {
  if (state.inflections.some((form) => COMPARISON.includes(form.type) && form.pos === pos)) return true
  if (pos !== 'adjective') return false
  const syllables = currentOf(state.live, 'syllables')?.payload.syllables.length
  return syllables === 1 || (syllables === 2 && state.lemma.endsWith('y'))
}

/** A counted noun sense whose live grammar makes it countable, so the noun has a plural. */
const hasCountableNoun = ({ counted, live }: EntryState) =>
  counted.some(
    (sense) =>
      sense.pos === 'noun' &&
      live
        .filter(isKind('grammar'))
        .some((fact) => fact.subjectId === sense.id && ['countable', 'both'].includes(fact.payload.countability ?? '')),
  )

type FormSlot = { type: FormType; pos: Pos }

/**
 * The inflections a single word's paradigm needs, by the parts of speech of its counted senses: a
 * verb's four forms, a countable noun's plural, and the comparative and superlative of an
 * adjective or adverb that compares with -er and -est. A phrase inflects in its words' entries,
 * and an invariable word (ago, ours) needs none.
 */
function formSlots(state: EntryState): FormSlot[] {
  if (isMultiword(state.lemma)) return []
  const poses = new Set(state.counted.map((sense) => sense.pos))
  return [
    ...(poses.has('verb') ? VERB_PARADIGM.map((type) => ({ type, pos: 'verb' as const })) : []),
    ...(hasCountableNoun(state) ? [{ type: 'plural' as const, pos: 'noun' as const }] : []),
    ...(['adjective', 'adverb'] as const)
      .filter((pos) => poses.has(pos) && compares(state, pos))
      .flatMap((pos) => COMPARISON.map((type) => ({ type, pos }))),
  ]
}

const fills = (state: EntryState) => (slot: FormSlot) =>
  state.inflections.some((form) => form.type === slot.type && form.pos === slot.pos)

const ACCENTS = accentSchema.options

/** The accents with a live strong (citation) pronunciation. */
const pronouncedAccents = ({ live }: EntryState) =>
  new Set(
    live
      .filter(isKind('pronunciation'))
      .filter((fact) => fact.payload.strength !== 'weak')
      .map((fact) => fact.payload.accent),
  )

/** Every single-word headword has a phrases slot: a learner's dictionary prints its phrases under it. */
const needsPhrases = ({ lemma, inventoried }: EntryState) => inventoried && !isMultiword(lemma)

/** An A1 or A2 single word, whose common derivatives a learner's dictionary lists with it. */
const needsFamily = ({ elementary, lemma }: EntryState) => elementary && !isMultiword(lemma)

/**
 * The entry's live irregular inflections, once per form type, spelling, and part of speech, each
 * with whether a live fact of it gives a pronunciation: a correction that adds one sits beside
 * its original while it is pending.
 */
function irregularForms({ lemma, live }: EntryState): Map<string, { form: string; pronounced: boolean }> {
  const forms = new Map<string, { form: string; pronounced: boolean }>()
  for (const fact of live.filter(isKind('form'))) {
    const { form, type, pos, ipa } = fact.payload
    if (!isIrregularForm(lemma, type, form)) continue
    const key = `${type}|${form}|${pos ?? ''}`
    forms.set(key, { form, pronounced: Boolean(ipa) || (forms.get(key)?.pronounced ?? false) })
  }
  return forms
}

interface EntryRule {
  gap: (state: EntryState) => EntryGap
  need: (state: EntryState) => number
  filled: (state: EntryState) => number
}

/** One translation slot: a counted sense's equivalent, or a current example or live collocation of one. */
interface TranslationTarget {
  of: Translated
  id: string
}

/**
 * The sense's live examples that no live correction supersedes: a pending correction stands for
 * its original.
 */
function currentExamples(live: readonly Fact[], senseId: SenseId): FactOf<'example'>[] {
  const examples = live.filter(isKind('example')).filter((fact) => fact.subjectId === senseId)
  return examples.filter((fact) => !examples.some((other) => other.supersedesId === fact.id))
}

/** What a learner reads in the entry and so needs in every served language. */
function translationTargets({ live, counted }: EntryState): TranslationTarget[] {
  return counted.flatMap((sense) => [
    { of: 'sense' as const, id: sense.id },
    ...currentExamples(live, sense.id).map((example) => ({ of: 'example' as const, id: example.id })),
    ...live
      .filter(isKind('collocation'))
      .filter((fact) => fact.subjectId === sense.id)
      .map((collocation) => ({ of: 'collocation' as const, id: collocation.id })),
  ])
}

const translated =
  ({ live }: EntryState, language: ServedLanguage) =>
  (target: TranslationTarget) =>
    live
      .filter(isKind('translation'))
      .some(
        (fact) => fact.subjectId === target.id && fact.payload.of === target.of && fact.payload.language === language,
      )

const translationRule = (language: ServedLanguage): EntryRule => ({
  gap: (state) => ({
    type: 'translations',
    language,
    missing: translationTargets(state).filter((target) => !translated(state, language)(target)),
  }),
  need: (state) => translationTargets(state).length,
  filled: (state) => translationTargets(state).filter(translated(state, language)).length,
})

/** A slot a pass completed without a value counts as filled. */
const passed = (state: EntryState, type: WorkType, subjectId: string) => state.passes.has(passKey(type, subjectId))

// A gap is open while fewer live facts fill it than it needs. The input facts are the entry's own
// (about the entry, its senses, or their facts) plus relations pointing at its senses, so a kind check scopes to the entry.
const entryGapRules: readonly EntryRule[] = [
  // The inventory is one slot; once it publishes, its senses are fixed.
  {
    gap: () => ({ type: 'senses' }),
    need: () => 1,
    filled: ({ inventoried }) => (inventoried ? 1 : 0),
  },
  {
    gap: (state) => ({ type: 'forms', missing: formSlots(state).filter((slot) => !fills(state)(slot)) }),
    need: (state) => formSlots(state).length,
    filled: (state) => formSlots(state).filter(fills(state)).length,
  },
  // A learner's dictionary gives both the British and the American pronunciation.
  {
    gap: (state) => ({
      type: 'pronunciation',
      accents: ACCENTS.filter((accent) => !pronouncedAccents(state).has(accent)),
    }),
    need: () => ACCENTS.length,
    filled: (state) => pronouncedAccents(state).size,
  },
  {
    gap: () => ({ type: 'phrases' }),
    need: (state) => (needsPhrases(state) ? 1 : 0),
    filled: (state) => (counting('phrases')(state) > 0 ? 1 : 0),
  },
  // One live derivative linked by its morphology fills it; the producer adds the common ones.
  {
    gap: () => ({ type: 'family' }),
    need: (state) => (needsFamily(state) ? 1 : 0),
    filled: (state) => (state.family.length > 0 ? 1 : 0),
  },
  // Word formation analyses one word; a phrase's parts are its own entries.
  {
    gap: () => ({ type: 'morphology' }),
    need: ({ lemma }) => (isMultiword(lemma) ? 0 : 1),
    filled: counting('morphology'),
  },
  // Syllables divide one written word; a phrase's words are their own entries.
  {
    gap: () => ({ type: 'syllables' }),
    need: ({ lemma }) => (isMultiword(lemma) ? 0 : 1),
    filled: counting('syllables'),
  },
  // A learner cannot work out how an irregular form sounds, so each needs a pronunciation.
  {
    gap: (state) => ({
      type: 'form_pronunciations',
      forms: [...irregularForms(state).values()].filter((form) => !form.pronounced).map(({ form }) => form),
    }),
    need: (state) => irregularForms(state).size,
    filled: (state) => [...irregularForms(state).values()].filter((form) => form.pronounced).length,
  },
  ...SERVED_LANGUAGES.map(translationRule),
]

/**
 * The parts of speech whose senses name a kind of thing, so a learner files them under an everyday
 * category ("dog": animal, pet). Learner's dictionaries file nouns, not verbs: asking every verb sense
 * for a broader verb built a WordNet-style troponym tree ("get": arrange, "come": include) that review
 * rejected half the time. A verb may still carry a hypernym; none is required.
 */
export const CATEGORY_POS: readonly Pos[] = ['noun']

/** The parts of speech of the things a learner's dictionary names main parts for ("bird": beak, wing). */
export const PARTS_POS: readonly Pos[] = ['noun']

/**
 * The parts of speech that have synonyms and antonyms a learner uses. A pronoun or another function
 * word has none in a learner's dictionary: "I" for the royal "we" kept failing review.
 */
export const SYNONYMS_POS: readonly Pos[] = ['noun', 'verb', 'adjective', 'adverb']

/**
 * How many live topic facts a sense of each part of speech needs. Nouns and verbs name the things
 * and actions a scene is made of; adjectives and adverbs may be tagged but need no topic, since
 * most are general (big, good), and function words belong to no scene. Zero means the sense has no
 * topics gap.
 */
export const TOPICS_NEEDED: Readonly<Record<Pos, number>> = {
  noun: 1,
  verb: 1,
  adjective: 0,
  adverb: 0,
  pronoun: 0,
  determiner: 0,
  number: 0,
  preposition: 0,
  conjunction: 0,
  interjection: 0,
  auxiliary: 0,
}

/**
 * How many grammar facts a sense needs. Countability is what a learner most needs of a noun,
 * transitivity of a verb, position, patterns, or prepositions of an adjective, the usual position
 * of an adverb, and what a determiner or pronoun agrees with ("each" + a singular noun). A number
 * takes no grammar a learner's dictionary prints.
 */
export const GRAMMAR_NEEDED: Readonly<Record<Pos, number>> = {
  noun: 1,
  verb: 1,
  adjective: 1,
  adverb: 1,
  pronoun: 1,
  determiner: 1,
  number: 0,
  preposition: 0,
  conjunction: 0,
  interjection: 0,
  auxiliary: 0,
}

/**
 * How many collocations a sense needs: content words, adverbs, and the function words a learner
 * meets in set combinations ("hardly any", "filled with", "both ... and"). A pronoun, number, or
 * interjection combines freely ("two cats", "the first day").
 */
export const COLLOCATIONS_NEEDED: Readonly<Record<Pos, number>> = {
  noun: 1,
  verb: 1,
  adjective: 1,
  adverb: 1,
  pronoun: 0,
  determiner: 1,
  number: 0,
  preposition: 1,
  conjunction: 1,
  interjection: 0,
  auxiliary: 0,
}

/**
 * The senses at the other end of the entry's relations that can show: a counted inventory of a
 * live entry lists them. A relation to any other sense is hidden from the public view, so it fills
 * nothing.
 */
function visibleNeighbors({ inventories, liveEntries }: GapInput['neighbors'], counts: Counts): ReadonlySet<string> {
  const byEntry = new Map<string, Fact[]>()
  for (const fact of inventories) byEntry.set(fact.subjectId, [...(byEntry.get(fact.subjectId) ?? []), fact])
  return new Set(
    [...byEntry]
      .filter(([entryId]) => liveEntries.has(entryId as EntryId))
      .flatMap(([, facts]) => inventorySenses(currentInventory(facts, counts)).map((sense) => sense.id)),
  )
}

/** The relation makes this sense a kind of a sense that can show, in the everyday layer. */
const everydayCategoryOf = (fact: Fact, senseId: SenseId, visible: ReadonlySet<string>) =>
  fact.kind === 'relation' &&
  fact.payload.type === 'hypernym' &&
  fact.payload.domain === undefined &&
  fact.subjectId === senseId &&
  visible.has(fact.payload.target_sense_id)

/** The sense has an everyday category, so it names a kind of thing whose parts a learner may need. */
const hasEverydayCategory = (sense: CountedSense, state: EntryState) =>
  state.live.some((fact) => everydayCategoryOf(fact, sense.id, state.visible))

/**
 * Examples a counted sense needs: two for a core sense at CEFR A1 or A2, where a learner meets the
 * word first, else one.
 */
const examplesNeeded = (senseId: SenseId, { elementary, core }: EntryState) => (elementary && core.has(senseId) ? 2 : 1)

interface SenseRule {
  /**
   * The counted senses the rule applies to: every common one, or only the core ones. A learner's
   * dictionary gives a sense beyond the first few its translation, an example, and its grammar,
   * never its own relations, topics, and collocations.
   */
  scope: 'core' | 'common'
  need: (sense: CountedSense, state: EntryState) => number
  fills: (fact: Fact, senseId: SenseId, state: EntryState) => boolean
  gap: (senseId: SenseId, filling: Fact[], state: EntryState) => SenseGap
}

const onePer = (poses: readonly Pos[]) => (sense: CountedSense) => (poses.includes(sense.pos) ? 1 : 0)

const senseGapRules: readonly SenseRule[] = [
  // One everyday category opens the slot's work; a word may have several, and the producer
  // submits every one a learner uses. Narrower terms are never asked of the category word.
  {
    scope: 'core',
    need: onePer(CATEGORY_POS),
    fills: (fact, senseId, state) => everydayCategoryOf(fact, senseId, state.visible),
    gap: (senseId) => ({ type: 'category', sense_id: senseId }),
  },
  // A thing placed in an everyday category may have main parts a learner needs; a sense whose
  // category is closed as general or abstract has none to ask for.
  {
    scope: 'core',
    need: (sense, state) => (PARTS_POS.includes(sense.pos) && hasEverydayCategory(sense, state) ? 1 : 0),
    fills: (fact, senseId, state) =>
      fact.kind === 'relation' &&
      fact.payload.type === 'part_of' &&
      fact.objectId === senseId &&
      state.visible.has(fact.subjectId),
    gap: (senseId) => ({ type: 'parts', sense_id: senseId }),
  },
  {
    scope: 'core',
    need: onePer(SYNONYMS_POS),
    fills: (fact, senseId, state) =>
      fact.kind === 'relation' &&
      (fact.payload.type === 'synonym' || fact.payload.type === 'antonym') &&
      ((fact.subjectId === senseId && state.visible.has(fact.payload.target_sense_id)) ||
        (fact.objectId === senseId && state.visible.has(fact.subjectId))),
    gap: (senseId) => ({ type: 'synonyms', sense_id: senseId }),
  },
  {
    scope: 'common',
    need: (sense, state) => examplesNeeded(sense.id, state),
    fills: (fact, senseId) => fact.kind === 'example' && fact.subjectId === senseId,
    gap: (senseId, filling, state) => ({
      type: 'examples',
      sense_id: senseId,
      count: filling.length,
      need: examplesNeeded(senseId, state),
    }),
  },
  {
    scope: 'core',
    need: (sense) => TOPICS_NEEDED[sense.pos],
    fills: (fact, senseId) => fact.kind === 'topic' && fact.subjectId === senseId,
    gap: (senseId) => ({ type: 'topics', sense_id: senseId }),
  },
  {
    scope: 'common',
    need: (sense) => GRAMMAR_NEEDED[sense.pos],
    fills: (fact, senseId) => fact.kind === 'grammar' && fact.subjectId === senseId,
    gap: (senseId) => ({ type: 'grammar', sense_id: senseId }),
  },
  {
    scope: 'core',
    need: (sense) => COLLOCATIONS_NEEDED[sense.pos],
    fills: (fact, senseId) => fact.kind === 'collocation' && fact.subjectId === senseId,
    gap: (senseId) => ({ type: 'collocations', sense_id: senseId }),
  },
]

interface OpenGap {
  gap: Gap
  /** How many more counted facts the gap needs to close. */
  missing: number
}

/** How many of the first common senses of the inventory are core, whatever their parts of speech. */
export const CORE_SENSES = 3

/**
 * The core senses of the counted ones: the first `CORE_SENSES` common senses of the inventory, and
 * the first common sense of each part of speech those leave out.
 */
function coreSenses(counted: readonly CountedSense[]): ReadonlySet<SenseId> {
  const first = counted.slice(0, CORE_SENSES)
  const covered = new Set(first.map((sense) => sense.pos))
  const firstOfPos = counted.filter(
    (sense, at) => !covered.has(sense.pos) && counted.findIndex((other) => other.pos === sense.pos) === at,
  )
  return new Set([...first, ...firstOfPos].map((sense) => sense.id))
}

/** The per-sense rules that apply to a counted sense: the common ones, and the core ones for a core sense. */
const rulesFor = (sense: CountedSense, state: EntryState) =>
  senseGapRules.filter((rule) => rule.scope === 'common' || state.core.has(sense.id))

/**
 * The open gaps, and how many slots the rules count for the entry: each entry rule and, per counted
 * sense, each need. `counts` picks the facts that fill: the live ones, or only the published ones.
 */
function openGaps(
  snapshot: GapInput,
  counts: Counts,
): {
  open: OpenGap[]
  slots: number
} {
  const live = [...snapshot.facts, ...snapshot.incoming].filter((fact) => counts(fact.status))
  const inventory = currentInventory(snapshot.facts, counts)
  const counted = inventorySenses(inventory)
    .filter((sense) => sense.rank === 'common')
    .map(({ id, pos }) => ({ id, pos }))
  const state: EntryState = {
    entryId: snapshot.entry.id,
    lemma: snapshot.entry.lemma,
    elementary: snapshot.levelRank !== null && snapshot.levelRank <= 2,
    family: snapshot.family,
    facts: snapshot.facts,
    live,
    inventoried: inventory !== null,
    counted,
    core: coreSenses(counted),
    inflections: inflectionsOf(live, counted),
    visible: visibleNeighbors(snapshot.neighbors, counts),
    passes: snapshot.passes,
  }
  // Until the inventory exists, the entry's only work is the inventory itself.
  const rules = inventory === null ? entryGapRules.slice(0, 1) : entryGapRules
  const entry = rules.flatMap((rule) => {
    const missing = rule.need(state) - rule.filled(state)
    if (missing <= 0) return []
    const gap = rule.gap(state)
    return passed(state, gap.type, snapshot.entry.id) ? [] : [{ gap, missing }]
  })
  const entrySlots = rules.reduce((need, rule) => need + rule.need(state), 0)
  const perSense = counted.flatMap((sense) =>
    rulesFor(sense, state).flatMap((rule) => {
      const filling = live.filter((fact) => rule.fills(fact, sense.id, state))
      const gap = rule.gap(sense.id, filling, state)
      const done = passed(state, gap.type, sense.id)
      const missing = done ? 0 : rule.need(sense, state) - filling.length
      return missing > 0 ? [{ gap, missing }] : []
    }),
  )
  const senseSlots = counted.reduce(
    (sum, sense) => sum + rulesFor(sense, state).reduce((need, rule) => need + rule.need(sense, state), 0),
    0,
  )
  return { open: [...entry, ...perSense], slots: entrySlots + senseSlots }
}

/**
 * What the entry still lacks, judged from its live facts. A sense counts while its gloss fact is
 * live and the entry's sense list does not put it in extra, and a relation while the sense at its
 * other end has a live gloss and a live entry fact.
 */
export function entryGaps(snapshot: GapInput): Gap[] {
  return openGaps(snapshot, isLive).open.map(({ gap }) => gap)
}

/** The node a piece of open work is about: its sense, or else the entry. */
export function subjectOf(gap: Gap, entryId: EntryId): string {
  if ('sense_id' in gap) return gap.sense_id
  return entryId
}

/**
 * How many more facts a gap needs, read from the gap itself: a pass made progress on an item when
 * this fell below what its claim found.
 */
export function missingOf(gap: Gap): number {
  switch (gap.type) {
    case 'forms':
      return gap.missing.length
    case 'pronunciation':
      return gap.accents.length
    case 'form_pronunciations':
      return gap.forms.length
    case 'translations':
      return gap.missing.length
    case 'examples':
      return gap.need - gap.count
    default:
      return 1
  }
}

/**
 * One piece of open work as the rescore finds it. `awaiting`: a pending fact changes it, so it is
 * judged once that fact's review settles; `gap` is then the live view of it, or the settled one
 * when the pending facts close it.
 */
export interface OpenWork {
  gap: Gap
  subjectId: string
  awaiting: boolean
}

/**
 * The slots the gap rules count for the entry over its live facts, and how many of them published
 * facts fill as the settled computation counts them; the rest of the filled ones only pending facts
 * fill.
 */
export interface SlotCounts {
  total: number
  published: number
  pending: number
}

export interface EntryAssessment {
  /** Every piece of open work. */
  work: OpenWork[]
  /** Filled slots over the slots the gap rules count, 0..1; 1 exactly when there are no gaps. */
  completeness: number
  /**
   * The lowest credibility of the entry's published facts and of its optional slots a pass left
   * empty, 0..1: how far a reader can trust the weakest thing the entry shows. 1 with none.
   */
  credibility: number
  slots: SlotCounts
}

const keyOf = (type: WorkType, subjectId: string) => `${type}|${subjectId}`

/** A gap as text with its keys sorted, so two gaps compare equal exactly when they say the same. */
export const gapText = (gap: Gap | undefined): string =>
  JSON.stringify(gap ?? null, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
      : value,
  )

/**
 * The open work of an entry, keyed by type and node, as the facts `counts` counts give it. An
 * entry whose entry fact is not counted has none.
 */
function openWorkOf(snapshot: EntryFacts, counts: Counts): Map<string, Gap> {
  if (!snapshot.entry.live) return new Map()
  const gaps = openGaps(snapshot, counts).open.map(({ gap }) => gap)
  return new Map(gaps.map((gap) => [keyOf(gap.type, subjectOf(gap, snapshot.entry.id)), gap]))
}

/** The lowest credibility among the entry's published facts and its empty optional passes. */
function credibilityOf({ facts, passes }: Pick<EntryFacts, 'facts' | 'passes'>): number {
  const scores = [
    ...facts.filter((fact) => fact.status === 'published').flatMap((fact) => factCredibility(fact) ?? []),
    ...[...passes].flatMap((key) => {
      const type = key.slice(0, key.indexOf('|')) as WorkType
      return isOptionalGap(type) ? [passCredibility(type)] : []
    }),
  ]
  return scores.length === 0 ? 1 : Math.min(...scores)
}

/**
 * Scores the entry from its live facts and lists its open work. Each piece is compared with the
 * same computation over the published facts alone: where they differ, a pending fact may still
 * change it, so it waits for that review instead of being worked or judged.
 */
const missingSlots = ({ open }: ReturnType<typeof openGaps>) => open.reduce((sum, { missing }) => sum + missing, 0)
const filledSlots = (gaps: ReturnType<typeof openGaps>) => gaps.slots - missingSlots(gaps)

export function assessEntry(snapshot: EntryFacts): EntryAssessment {
  const live = openGaps(snapshot, isLive)
  const missing = missingSlots(live)
  const filled = filledSlots(live)
  // A pending inventory can drop slots the published facts fill, so the published count is capped
  // at what the live view fills.
  const published = Math.min(filled, filledSlots(openGaps(snapshot, isSettled)))
  const current = openWorkOf(snapshot, isLive)
  const settled = openWorkOf(snapshot, isSettled)
  const work = [...new Set([...current.keys(), ...settled.keys()])].flatMap((key): OpenWork[] => {
    const now = current.get(key)
    const then = settled.get(key)
    const gap = now ?? then
    if (!gap) return []
    return [
      {
        gap,
        subjectId: subjectOf(gap, snapshot.entry.id),
        awaiting: gapText(now) !== gapText(then),
      },
    ]
  })
  return {
    work,
    completeness: live.slots === 0 ? 1 : 1 - missing / live.slots,
    credibility: credibilityOf(snapshot),
    slots: { total: live.slots, published, pending: filled - published },
  }
}

/**
 * What learner priority reads about an entry: the batch its headword was imported in (a phrase
 * takes its headword's), its lowest CEFR level as `levelRank` (1 for A1 to 6 for C2; null without
 * one), and its Zipf frequency.
 */
export interface LearnerPriority {
  batch: number
  levelRank: number | null
  zipf: number | null
}

/** The learner band: CEFR A1 to C2 are 0 to 5, then entries with a frequency but no level (6), then the rest (7). */
export function learnerBand({ levelRank, zipf }: Pick<LearnerPriority, 'levelRank' | 'zipf'>): number {
  if (levelRank !== null) return levelRank - 1
  return zipf === null ? 7 : 6
}

export const BANDS = 8

/** The learner bands finished first, every stage of them before any other band's work: A1 and A2. */
export const CORE_BANDS = 2

/** The last stage of the policy; a core band's items all rank before any other band's. */
export const STAGES = 4

/**
 * The priority policy, the one table of what each type of work is worth and what a worker needs to
 * do it. `stage` orders the work of a tier: 1 identity (the sense inventory), 2 network (categories,
 * parts, synonyms, family, phrases, topics), 3 meaning (translations), 4 usage. The core bands (A1,
 * A2) are one tier and finish every stage first; the other bands follow, stage by stage. Batches
 * come before all of that: a later batch of headwords waits for the earlier one. `context: 'entry'`
 * hands the worker the entry's whole management view, for work that reads every sense at once;
 * `'node'` the facts about the item's node.
 */
export const WORK_POLICY: Readonly<Record<WorkType, { stage: number; context: 'entry' | 'node' }>> = {
  senses: { stage: 1, context: 'entry' },
  category: { stage: 2, context: 'node' },
  parts: { stage: 2, context: 'node' },
  synonyms: { stage: 2, context: 'node' },
  family: { stage: 2, context: 'entry' },
  phrases: { stage: 2, context: 'entry' },
  topics: { stage: 2, context: 'node' },
  translations: { stage: 3, context: 'entry' },
  examples: { stage: 4, context: 'node' },
  grammar: { stage: 4, context: 'node' },
  collocations: { stage: 4, context: 'node' },
  forms: { stage: 4, context: 'node' },
  pronunciation: { stage: 4, context: 'node' },
  syllables: { stage: 4, context: 'node' },
  morphology: { stage: 4, context: 'node' },
  form_pronunciations: { stage: 4, context: 'node' },
}

/** The ranks one batch spans: two tiers of every stage of every band. */
export const BATCH_SPAN = 2 * (STAGES + 1) * BANDS

/**
 * Where an item sorts, lowest first: its entry's batch, then its tier (the core bands A1 and A2
 * first), then its type's stage, then the learner band of its entry; within a rank, the more
 * frequent entry first (`zipfOrder` descending, -1 for none, which sorts last).
 */
export function workPriority(
  type: WorkType,
  learner: LearnerPriority,
): { stage: number; rank: number; zipfOrder: number } {
  const { stage } = WORK_POLICY[type]
  const band = learnerBand(learner)
  const tier = band < CORE_BANDS ? 0 : 1
  return {
    stage,
    rank: learner.batch * BATCH_SPAN + tier * (STAGES + 1) * BANDS + stage * BANDS + band,
    zipfOrder: learner.zipf ?? -1,
  }
}

/** A stored work item as the rescore and the claim read it. */
export interface WorkItem {
  id: WorkItemId
  entryId: EntryId
  type: WorkType
  subjectId: string
  gap: Gap
  stage: number
  rank: number
  zipfOrder: number
  awaiting: boolean
  attempts: number
  /** A completed pass worked the item and its verdict is not drawn yet: the item awaited review. */
  worked: boolean
  /** That pass found no value for its optional slot and submitted none (`found_none`). */
  foundNone: boolean
  /** The gap when the item was last claimed; null before its first claim. */
  claimedGap: Gap | null
  lease: { id: WorkLeaseId; holder: PrincipalRef; expiresAt: string } | null
  lastWorkedAt: string | null
  lastWorkedBy: PrincipalRef | null
  lastNote: string | null
}

/** What a rescore writes of an item: everything but its id, lease, and claim and work records. */
export type WorkItemWrite = Pick<
  WorkItem,
  'type' | 'subjectId' | 'gap' | 'stage' | 'rank' | 'zipfOrder' | 'awaiting' | 'attempts' | 'worked' | 'foundNone'
>

/**
 * The verdict a rescore draws on the completed pass at a worked item: `closed` when its gap is
 * gone, `passed` when it is an optional slot whose pass found none (it closes with the pass),
 * `progressed` when fewer facts are missing than its claim found, `no_progress` otherwise, and
 * `stuck` when that pass reached `MAX_PASSES`: the item becomes a ticket.
 */
export type AttemptVerdict = 'closed' | 'passed' | 'progressed' | 'no_progress' | 'stuck'

export interface ReconciledItems {
  writes: Array<WorkItemWrite & { id: WorkItemId | null }>
  deletes: WorkItemId[]
  /** The worked items this rescore judged; an item still awaiting review has none yet. */
  verdicts: Array<{ id: WorkItemId; verdict: AttemptVerdict; type: WorkType; subjectId: string }>
}

/**
 * Brings an entry's stored items to its open work: one item per piece, the rest deleted. A write
 * keeps the id of the stored item it updates; a new piece has none yet. While a piece awaits
 * review its attempts and pending verdict are kept. Once settled, a worked item is judged: an
 * optional slot whose pass found none is complete; otherwise the pass made progress only if fewer
 * facts are missing than its claim found, which resets its attempts, and else counts an attempt. A
 * change that only reshuffles the gap (a fact retracted and resubmitted) is no progress.
 */
export function reconcileItems(
  stored: readonly WorkItem[],
  open: readonly OpenWork[],
  learner: LearnerPriority,
): ReconciledItems {
  const byKey = new Map(stored.map((item) => [keyOf(item.type, item.subjectId), item]))
  const verdicts: ReconciledItems['verdicts'] = []
  const judged = (item: WorkItem, verdict: AttemptVerdict) =>
    verdicts.push({ id: item.id, verdict, type: item.type, subjectId: item.subjectId })
  const writes = open.flatMap((work) => {
    const item = byKey.get(keyOf(work.gap.type, work.subjectId))
    const base = {
      id: item?.id ?? null,
      type: work.gap.type,
      subjectId: work.subjectId,
      gap: work.gap,
      awaiting: work.awaiting,
      ...workPriority(work.gap.type, learner),
    }
    if (!item) return [{ ...base, attempts: 0, worked: false, foundNone: false }]
    if (work.awaiting || !item.worked)
      return [{ ...base, attempts: item.attempts, worked: item.worked, foundNone: item.foundNone }]
    if (isOptionalGap(work.gap.type) && item.foundNone) {
      judged(item, 'passed')
      return []
    }
    const before = item.claimedGap ? missingOf(item.claimedGap) : Number.POSITIVE_INFINITY
    if (missingOf(work.gap) < before) {
      judged(item, 'progressed')
      return [{ ...base, attempts: 0, worked: false, foundNone: false }]
    }
    const attempts = item.attempts + 1
    judged(item, attempts >= MAX_PASSES ? 'stuck' : 'no_progress')
    return [{ ...base, attempts, worked: false, foundNone: false }]
  })
  const kept = new Set(writes.map((write) => keyOf(write.type, write.subjectId)))
  const passedKeys = new Set(
    verdicts.filter((verdict) => verdict.verdict === 'passed').map((verdict) => keyOf(verdict.type, verdict.subjectId)),
  )
  const closed = stored.filter((item) => !kept.has(keyOf(item.type, item.subjectId)))
  for (const item of closed) {
    if (item.worked && !passedKeys.has(keyOf(item.type, item.subjectId))) judged(item, 'closed')
  }
  return { writes, deletes: closed.map((item) => item.id), verdicts }
}

/** Where an item stands for a worker: in the production queue, waiting on reviews, or a ticket. */
export function itemState(item: Pick<WorkItem, 'awaiting' | 'attempts'>): 'open' | 'awaiting_review' | 'ticket' {
  if (item.attempts >= MAX_PASSES) return 'ticket'
  return item.awaiting ? 'awaiting_review' : 'open'
}
