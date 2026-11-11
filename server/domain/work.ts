import {
  accentSchema,
  type EntryId,
  type FactId,
  type FactStatus,
  type FormType,
  type Pos,
  type SenseId,
} from '@shared/facts'
import type { Gap, WeakFact, WorkItemId, WorkLeaseId, WorkType } from '@shared/work'
import { type Fact, type FactOf, isKind } from './fact'
import { formMeaning, isIrregularForm, isPeriphrastic } from './fact-kinds'
import { isLive } from './fact-lifecycle'
import type { SenseNode } from './nodes'
import type { PrincipalRef } from './principal'
import { currentSenseList, listsExactly } from './sense-list'
import { isMultiword } from './term'

/** What the work rules read about an entry: its senses, its facts in every status, and its open feedback. */
export interface EntryFacts {
  entry: { id: EntryId; lemma: string }
  /** The entry's learner level: 1 for A1 to 6 for C2 (`levelRank`); null without a CEFR level. */
  levelRank: number | null
  /** A CEFR learner list names the exact lemma as an A1 or A2 verb (`lemma_cefr`). */
  coreVerb: boolean
  /**
   * The lemmas of the live multiword entries headed by this lemma: its first word, with a live verb
   * sense (phrasal verbs and verb idioms). Empty for a phrase.
   */
  phrases: readonly string[]
  /**
   * The lemmas of the other live entries with a live morphology fact whose base part names this
   * lemma: its word family.
   */
  family: readonly string[]
  senses: readonly SenseNode[]
  /** Facts whose subject is the entry or one of its senses. */
  facts: Fact[]
  /** Relation facts whose object is one of the entry's senses. */
  incoming: Fact[]
  /** Facts that an open or claimed feedback item targets. */
  flagged: ReadonlySet<FactId>
  /** Senses at the other end of the entry's relations, with their `entry` and `sense` facts. */
  neighbors: { senses: readonly SenseNode[]; facts: Fact[] }
}

type GapInput = Pick<
  EntryFacts,
  'entry' | 'levelRank' | 'coreVerb' | 'phrases' | 'family' | 'senses' | 'facts' | 'incoming' | 'neighbors'
>

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
      | 'sense_list'
      | 'forms'
      | 'pronunciation'
      | 'phrases'
      | 'family'
      | 'morphology'
      | 'syllables'
      | 'form_pronunciations'
  }
>
type SenseGap = Exclude<Gap, EntryGap | WeakFact>

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
  lemma: string
  /** The entry is at CEFR A1 or A2, where a learner needs more of each sense. */
  core: boolean
  /** A CEFR learner list names the lemma as an A1 or A2 verb, which a learner meets in phrasal verbs. */
  coreVerb: boolean
  phrases: readonly string[]
  family: readonly string[]
  facts: readonly Fact[]
  live: Fact[]
  senses: SenseNode[]
  counted: SenseNode[]
  inflections: Inflection[]
  /** The neighbor senses a relation may link to and count. */
  visible: ReadonlySet<string>
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

/**
 * The inventory gap: senses while there are none, else a list naming exactly the senses. A
 * rejected list leaves the gap as it was, so each rejected pass counts an attempt of its item.
 */
function inventoryGap({ senses }: EntryState): EntryGap {
  if (senses.length === 0) return { type: 'senses' }
  return { type: 'sense_list', senses: senses.map((sense) => sense.id) }
}

/**
 * The sense inventory is one slot: settled while the entry's sense list names exactly its live
 * senses. Its gap asks for senses while the entry has none, and for a list once it has some.
 */
function inventorySettled({ live, senses }: EntryState): number {
  const list = currentSenseList(live)
  const ids = senses.map((sense) => sense.id)
  return list !== null && ids.length > 0 && listsExactly(list.payload, ids) ? 1 : 0
}

/** The entry's live inflections, periphrastic comparisons left out, each with the part of speech it fills. */
function inflectionsOf(live: readonly Fact[], counted: readonly SenseNode[]): Inflection[] {
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

/**
 * A core verb: a single word that a CEFR learner list names as an A1 or A2 verb, with a counted
 * verb sense. Only those reliably head several learner phrasal verbs; asking the same of a verb
 * made from a noun (telephone, party, key, map, fish) had producers coin "telephone in" and
 * "party down" to fill the slots.
 */
const needsPhrases = ({ coreVerb, lemma, counted }: EntryState) =>
  coreVerb && !isMultiword(lemma) && counted.some((sense) => sense.pos === 'verb')

/**
 * How many phrasal verbs or verb idioms headed by it a core verb needs: a learner's dictionary
 * lists several for most common verbs (throw away, throw out, throw up).
 */
export const PHRASES_NEEDED = 3

const phrasesNeeded = (state: EntryState) => (needsPhrases(state) ? PHRASES_NEEDED : 0)

/** An A1 or A2 single word, whose common derivatives a learner's dictionary lists with it. */
const needsFamily = ({ core, lemma }: EntryState) => core && !isMultiword(lemma)

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
  /** The gap a gap_closure fact on the entry closes, filling every slot of the rule; absent when none may. */
  closable?: 'forms' | 'phrases' | 'family'
}

// A gap is open while fewer live facts fill it than it needs. The input facts are the entry's own
// (about the entry or its senses) plus relations pointing at its senses, so a kind check scopes to the entry.
const entryGapRules: readonly EntryRule[] = [
  {
    gap: inventoryGap,
    need: () => 1,
    filled: inventorySettled,
  },
  {
    gap: (state) => ({ type: 'forms', missing: formSlots(state).filter((slot) => !fills(state)(slot)) }),
    need: (state) => formSlots(state).length,
    filled: (state) => formSlots(state).filter(fills(state)).length,
    closable: 'forms',
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
    gap: (state) => ({ type: 'phrases', have: [...state.phrases], need: phrasesNeeded(state) }),
    need: phrasesNeeded,
    filled: (state) => Math.min(state.phrases.length, phrasesNeeded(state)),
    closable: 'phrases',
  },
  // One live derivative linked by its morphology fills it; the producer adds the common ones.
  {
    gap: () => ({ type: 'family' }),
    need: (state) => (needsFamily(state) ? 1 : 0),
    filled: ({ family }) => Math.min(family.length, 1),
    closable: 'family',
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
 * The senses at the other end of the entry's relations that can show: their gloss and their
 * entry's fact are counted. A relation to any other sense is hidden from the public view, so it
 * fills nothing.
 */
function visibleNeighbors({ senses, facts }: GapInput['neighbors'], counts: Counts): ReadonlySet<string> {
  const shown = new Set(facts.filter((fact) => counts(fact.status)).map((fact) => `${fact.kind}:${fact.subjectId}`))
  return new Set(
    senses.filter((sense) => shown.has(`sense:${sense.id}`) && shown.has(`entry:${sense.entryId}`)).map(({ id }) => id),
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
const hasEverydayCategory = (sense: SenseNode, state: EntryState) =>
  state.live.some((fact) => everydayCategoryOf(fact, sense.id, state.visible))

/** Examples a counted sense needs: two at CEFR A1 or A2, where a learner meets the word first, else one. */
const examplesNeeded = ({ core }: EntryState) => (core ? 2 : 1)

/**
 * The sense's live examples that no live correction supersedes: a pending correction that adds a
 * translation stands for its original.
 */
function currentExamples(live: readonly Fact[], senseId: SenseId): FactOf<'example'>[] {
  const examples = live.filter(isKind('example')).filter((fact) => fact.subjectId === senseId)
  return examples.filter((fact) => !examples.some((other) => other.supersedesId === fact.id))
}

interface SenseRule {
  need: (sense: SenseNode, state: EntryState) => number
  fills: (fact: Fact, senseId: SenseId, state: EntryState) => boolean
  gap: (senseId: SenseId, filling: Fact[], state: EntryState) => SenseGap
  /** The gap a gap_closure fact on the sense closes, filling every slot of the rule; absent when none may. */
  closable?: 'category' | 'parts' | 'synonyms' | 'topics' | 'grammar' | 'collocations'
}

const onePer = (poses: readonly Pos[]) => (sense: SenseNode) => (poses.includes(sense.pos) ? 1 : 0)

const senseGapRules: readonly SenseRule[] = [
  // One everyday category opens the slot's work; a word may have several, and the producer
  // submits every one a learner uses. Narrower terms are never asked of the category word.
  {
    need: onePer(CATEGORY_POS),
    fills: (fact, senseId, state) => everydayCategoryOf(fact, senseId, state.visible),
    gap: (senseId) => ({ type: 'category', sense_id: senseId }),
    closable: 'category',
  },
  // A thing placed in an everyday category may have main parts a learner needs; a sense whose
  // category is closed as general or abstract has none to ask for.
  {
    need: (sense, state) => (PARTS_POS.includes(sense.pos) && hasEverydayCategory(sense, state) ? 1 : 0),
    fills: (fact, senseId, state) =>
      fact.kind === 'relation' &&
      fact.payload.type === 'part_of' &&
      fact.objectId === senseId &&
      state.visible.has(fact.subjectId),
    gap: (senseId) => ({ type: 'parts', sense_id: senseId }),
    closable: 'parts',
  },
  {
    need: onePer(SYNONYMS_POS),
    fills: (fact, senseId, state) =>
      fact.kind === 'relation' &&
      (fact.payload.type === 'synonym' || fact.payload.type === 'antonym') &&
      ((fact.subjectId === senseId && state.visible.has(fact.payload.target_sense_id)) ||
        (fact.objectId === senseId && state.visible.has(fact.subjectId))),
    gap: (senseId) => ({ type: 'synonyms', sense_id: senseId }),
    closable: 'synonyms',
  },
  {
    need: (_sense, state) => examplesNeeded(state),
    fills: (fact, senseId) => fact.kind === 'example' && fact.subjectId === senseId,
    gap: (senseId, filling, state) => ({
      type: 'examples',
      sense_id: senseId,
      count: filling.length,
      need: examplesNeeded(state),
    }),
  },
  {
    need: () => 1,
    fills: (fact, senseId) =>
      fact.kind === 'translation' && fact.subjectId === senseId && fact.payload.language === 'zh',
    gap: (senseId) => ({ type: 'translations', sense_id: senseId, language: 'zh' }),
  },
  // Every example a learner reads needs its translation: one slot per current live example, and
  // one per example the sense still needs, which comes with its translation.
  {
    need: (sense, state) => Math.max(examplesNeeded(state), currentExamples(state.live, sense.id).length),
    fills: (fact, senseId, state) =>
      fact.kind === 'example' &&
      fact.subjectId === senseId &&
      Boolean(fact.payload.translations?.zh) &&
      currentExamples(state.live, senseId).some((example) => example.id === fact.id),
    gap: (senseId, _filling, state) => ({
      type: 'example_translations',
      sense_id: senseId,
      language: 'zh',
      examples: currentExamples(state.live, senseId)
        .filter((example) => !example.payload.translations?.zh)
        .map((example) => example.id),
    }),
  },
  {
    need: (sense) => TOPICS_NEEDED[sense.pos],
    fills: (fact, senseId) => fact.kind === 'topic' && fact.subjectId === senseId,
    gap: (senseId) => ({ type: 'topics', sense_id: senseId }),
    closable: 'topics',
  },
  {
    need: (sense) => GRAMMAR_NEEDED[sense.pos],
    fills: (fact, senseId) => fact.kind === 'grammar' && fact.subjectId === senseId,
    gap: (senseId) => ({ type: 'grammar', sense_id: senseId }),
    closable: 'grammar',
  },
  {
    need: (sense) => COLLOCATIONS_NEEDED[sense.pos],
    fills: (fact, senseId) => fact.kind === 'collocation' && fact.subjectId === senseId,
    gap: (senseId) => ({ type: 'collocations', sense_id: senseId }),
    closable: 'collocations',
  },
]

interface OpenGap {
  gap: Gap
  /** How many more counted facts the gap needs to close. */
  missing: number
}

/**
 * The senses the per-sense rules count: those whose gloss is live, less the extra senses of the
 * entry's sense list. Rare senses never count toward completeness; before a list exists, all do.
 */
function countedSenses(live: readonly Fact[], senses: readonly SenseNode[]): SenseNode[] {
  const extra = new Set(currentSenseList(live)?.payload.extra)
  return senses.filter((sense) => !extra.has(sense.id))
}

/** A counted gap_closure fact on the node closes the gap: its slots count as filled. */
const closedBy = (live: readonly Fact[], gap: string | undefined, subjectId: string) =>
  gap !== undefined &&
  live.filter(isKind('gap_closure')).some((fact) => fact.subjectId === subjectId && fact.payload.gap === gap)

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
  const glossed = new Set(live.flatMap((fact) => (fact.kind === 'sense' ? [fact.subjectId] : [])))
  const senses = snapshot.senses.filter((sense) => glossed.has(sense.id))
  const counted = countedSenses(live, senses)
  const state: EntryState = {
    lemma: snapshot.entry.lemma,
    core: snapshot.levelRank !== null && snapshot.levelRank <= 2,
    coreVerb: snapshot.coreVerb,
    phrases: snapshot.phrases,
    family: snapshot.family,
    facts: snapshot.facts,
    live,
    senses,
    counted,
    inflections: inflectionsOf(live, counted),
    visible: visibleNeighbors(snapshot.neighbors, counts),
  }
  const entry = entryGapRules.flatMap((rule) => {
    const missing = closedBy(live, rule.closable, snapshot.entry.id) ? 0 : rule.need(state) - rule.filled(state)
    return missing > 0 ? [{ gap: rule.gap(state), missing }] : []
  })
  const entrySlots = entryGapRules.reduce((need, rule) => need + rule.need(state), 0)
  const perSense = counted.flatMap((sense) =>
    senseGapRules.flatMap((rule) => {
      const filling = live.filter((fact) => rule.fills(fact, sense.id, state))
      const missing = closedBy(live, rule.closable, sense.id) ? 0 : rule.need(sense, state) - filling.length
      return missing > 0 ? [{ gap: rule.gap(sense.id, filling, state), missing }] : []
    }),
  )
  const senseSlots = counted.reduce(
    (sum, sense) => sum + senseGapRules.reduce((need, rule) => need + rule.need(sense, state), 0),
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

/**
 * The entry's facts worth replacing, among those `counts` counts: one that open feedback targets,
 * one published on an uncertain verdict, or one a review in place failed that stays published (a
 * gloss, which a correction replaces). A fact a counted correction supersedes is being replaced,
 * so it is not listed. Relations count on the entry their subject belongs to.
 */
export function weakFacts(snapshot: Pick<EntryFacts, 'facts' | 'flagged'>, counts: Counts = isLive): WeakFact[] {
  const counted = snapshot.facts.filter((fact) => counts(fact.status))
  const replaced = new Set(counted.flatMap((fact) => (fact.supersedesId ? [fact.supersedesId] : [])))
  return counted
    .filter((fact) => !replaced.has(fact.id))
    .flatMap((fact): WeakFact[] => {
      const weak = (reason: WeakFact['reason']): WeakFact[] => [
        { type: 'weak_fact', fact_id: fact.id, kind: fact.kind, reason },
      ]
      if (snapshot.flagged.has(fact.id)) return weak('feedback')
      if (fact.status === 'published' && fact.review?.verdict === 'uncertain') return weak('uncertain')
      if (fact.status === 'published' && fact.review?.verdict === 'fail') return weak('failed')
      return []
    })
}

/** The node a piece of open work is about: its sense, its weak fact, or else the entry. */
export function subjectOf(gap: Gap, entryId: EntryId): string {
  if ('sense_id' in gap) return gap.sense_id
  if ('fact_id' in gap) return gap.fact_id
  return entryId
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

export interface EntryAssessment {
  /** Every piece of open work: each gap and each weak fact. */
  work: OpenWork[]
  /** Filled slots over the slots the gap rules count, 0..1; 1 exactly when there are no gaps. */
  completeness: number
  /** One minus weak facts over live facts about the entry, 0..1; 1 exactly when no fact is weak. */
  quality: number
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
  const entryLive = snapshot.facts.some(
    (fact) => fact.kind === 'entry' && fact.subjectId === snapshot.entry.id && counts(fact.status),
  )
  if (!entryLive) return new Map()
  const gaps: Gap[] = [...openGaps(snapshot, counts).open.map(({ gap }) => gap), ...weakFacts(snapshot, counts)]
  return new Map(gaps.map((gap) => [keyOf(gap.type, subjectOf(gap, snapshot.entry.id)), gap]))
}

/**
 * Scores the entry from its live facts and lists its open work. Each piece is compared with the
 * same computation over the published facts alone: where they differ, a pending fact may still
 * change it, so it waits for that review instead of being worked or judged.
 */
export function assessEntry(snapshot: EntryFacts): EntryAssessment {
  const { open, slots } = openGaps(snapshot, isLive)
  const missing = open.reduce((sum, { missing }) => sum + missing, 0)
  const weak = weakFacts(snapshot)
  const live = snapshot.facts.filter((fact) => isLive(fact.status)).length
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
    completeness: 1 - missing / slots,
    quality: live === 0 ? 1 : 1 - weak.length / live,
  }
}

/**
 * What learner priority reads about an entry, from the reference data of its lemma: its lowest
 * CEFR level as `levelRank` (1 for A1 to 6 for C2; null without one) and its Zipf frequency.
 */
export interface LearnerPriority {
  levelRank: number | null
  zipf: number | null
}

/** The learner band: CEFR A1 to C2 are 0 to 5, then entries with a frequency but no level (6), then the rest (7). */
export function learnerBand({ levelRank, zipf }: LearnerPriority): number {
  if (levelRank !== null) return levelRank - 1
  return zipf === null ? 7 : 6
}

export const BANDS = 8

/**
 * The priority policy, the one table of what each type of work is worth and what a worker needs to
 * do it. `stage` orders the queue ahead of the learner band: 1 identity (the sense inventory), 2
 * meaning (translations, categories, parts), 3 usage, 4 network, 5 weak facts. So every A1-C2
 * noun's category comes before any B1 example. `context: 'entry'` hands the worker the entry's whole
 * management view, for work that reads every sense at once; `'node'` the facts about the item's node.
 */
export const WORK_POLICY: Readonly<Record<WorkType, { stage: number; context: 'entry' | 'node' }>> = {
  senses: { stage: 1, context: 'entry' },
  sense_list: { stage: 1, context: 'entry' },
  translations: { stage: 2, context: 'node' },
  category: { stage: 2, context: 'node' },
  parts: { stage: 2, context: 'node' },
  examples: { stage: 3, context: 'node' },
  example_translations: { stage: 3, context: 'node' },
  grammar: { stage: 3, context: 'node' },
  collocations: { stage: 3, context: 'node' },
  forms: { stage: 3, context: 'node' },
  pronunciation: { stage: 3, context: 'node' },
  syllables: { stage: 3, context: 'node' },
  morphology: { stage: 3, context: 'node' },
  form_pronunciations: { stage: 3, context: 'node' },
  synonyms: { stage: 4, context: 'node' },
  family: { stage: 4, context: 'entry' },
  phrases: { stage: 4, context: 'entry' },
  topics: { stage: 4, context: 'node' },
  weak_fact: { stage: 5, context: 'node' },
}

/**
 * Where an item sorts, lowest first: its type's stage, then the learner band of its entry, so the
 * stage dominates; within a rank, the more frequent entry first (`zipfOrder` descending, -1 for
 * none, which sorts last).
 */
export function workPriority(
  type: WorkType,
  learner: LearnerPriority,
): { stage: number; rank: number; zipfOrder: number } {
  const { stage } = WORK_POLICY[type]
  return { stage, rank: stage * BANDS + learnerBand(learner), zipfOrder: learner.zipf ?? -1 }
}

/**
 * How many completed passes may leave an item as their claim found it. The next one moves it out
 * of the production queue to the curators: the producers cannot fill it and should stop trying.
 */
export const MAX_ATTEMPTS = 3

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
  'type' | 'subjectId' | 'gap' | 'stage' | 'rank' | 'zipfOrder' | 'awaiting' | 'attempts' | 'worked'
>

/**
 * Brings an entry's stored items to its open work: one item per piece, the rest deleted. A write
 * keeps the id of the stored item it updates; a new piece has none yet. While a piece awaits
 * review its attempts and pending verdict are kept. Once settled, an item a completed pass worked
 * counts an attempt when the gap is still what its claim found, and any other change (another
 * principal's fact, a new sense, a partial fill) resets the attempts: the item is new work.
 */
export function reconcileItems(
  stored: readonly WorkItem[],
  open: readonly OpenWork[],
  learner: LearnerPriority,
): { writes: Array<WorkItemWrite & { id: WorkItemId | null }>; deletes: WorkItemId[] } {
  const byKey = new Map(stored.map((item) => [keyOf(item.type, item.subjectId), item]))
  const writes = open.map((work) => {
    const item = byKey.get(keyOf(work.gap.type, work.subjectId))
    const base = {
      id: item?.id ?? null,
      type: work.gap.type,
      subjectId: work.subjectId,
      gap: work.gap,
      awaiting: work.awaiting,
      ...workPriority(work.gap.type, learner),
    }
    if (!item) return { ...base, attempts: 0, worked: false }
    if (work.awaiting) return { ...base, attempts: item.attempts, worked: item.worked }
    const judgedAgainst = item.worked ? item.claimedGap : item.gap
    if (gapText(work.gap) !== gapText(judgedAgainst ?? undefined)) return { ...base, attempts: 0, worked: false }
    return { ...base, attempts: item.attempts + (item.worked ? 1 : 0), worked: false }
  })
  const kept = new Set(writes.map((write) => keyOf(write.type, write.subjectId)))
  const deletes = stored.filter((item) => !kept.has(keyOf(item.type, item.subjectId))).map((item) => item.id)
  return { writes, deletes }
}

/** Where an item stands for a worker: in the production queue, waiting on reviews, or with the curators. */
export function itemState(item: Pick<WorkItem, 'awaiting' | 'attempts'>): 'open' | 'awaiting_review' | 'curation' {
  if (item.attempts >= MAX_ATTEMPTS) return 'curation'
  return item.awaiting ? 'awaiting_review' : 'open'
}
