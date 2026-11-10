import {
  accentSchema,
  type ClosableGap,
  type EntryId,
  type FactId,
  type FormType,
  type Pos,
  relationTypeSchema,
  type SenseId,
} from '@shared/facts'
import type { Gap, WeakFact, WorkLeaseId } from '@shared/work'
import { type Fact, type FactOf, isKind } from './fact'
import { formMeaning, isIrregularForm, isPeriphrastic } from './fact-kinds'
import { isLive } from './fact-lifecycle'
import type { SenseNode } from './nodes'
import type { PrincipalRef } from './principal'
import { currentSenseList, listsExactly, rejectedAttempts } from './sense-list'
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

export interface WorkLease {
  id: WorkLeaseId
  entryId: EntryId
  holder: PrincipalRef
  /** When this lease's claim was made, which starts the pass. */
  claimedAt: string
  expiresAt: string
}

export function leaseExpiry(now: Date, leaseSeconds: number): string {
  return new Date(now.getTime() + leaseSeconds * 1000).toISOString()
}

/** Only the holder completes its lease, and only before it expires. */
export function completeDecision(lease: WorkLease, who: PrincipalRef, now: Date): 'allowed' | 'not_holder' | 'expired' {
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
type SenseGap = Exclude<Gap, EntryGap>
type RelationGap = Extract<Gap, { type: 'relations' }>

/** A live inflection with the part of speech it fills: its label, else the meaning the entry shows it under. */
interface Inflection {
  type: FormType
  pos: Pos | undefined
}

/**
 * What the gap rules read: the entry's facts in every status, the live ones, the senses whose
 * gloss is live, the counted ones among them, and the entry's live inflections.
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
 * How many sense lists a producer may submit for the same senses. Each rejection changes the
 * `sense_list` gap, so the pass that follows reads the review's reason; once this many are
 * rejected, another rejection leaves the open work as the claim found it and the entry stalls.
 */
export const MAX_SENSE_LIST_ATTEMPTS = 3

/** The inventory gap: senses while there are none, else a list, counting the attempts rejected so far. */
function inventoryGap({ facts, senses }: EntryState): EntryGap {
  if (senses.length === 0) return { type: 'senses' }
  const attempts = rejectedAttempts(
    facts,
    senses.map((sense) => sense.id),
  )
  return { type: 'sense_list', rejected: Math.min(attempts, MAX_SENSE_LIST_ATTEMPTS - 1) }
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

// A gap is open while fewer live facts fill it than it needs. The input facts are the entry's own
// (about the entry or its senses) plus relations pointing at its senses, so a kind check scopes to the entry.
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
  closable?: ClosableGap
}

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

const directions = ['outgoing', 'incoming'] as const

/** The distinct (type, direction) pairs of a sense's relations, in a stable order. */
function relationsHave(relations: FactOf<'relation'>[], senseId: SenseId): RelationGap['have'] {
  return relationTypeSchema.options.flatMap((type) =>
    directions
      .filter((direction) =>
        relations.some(
          (fact) => fact.payload.type === type && (fact.subjectId === senseId) === (direction === 'outgoing'),
        ),
      )
      .map((direction) => ({ type, direction })),
  )
}

/**
 * How many live relations a sense of each part of speech needs. The relation types (synonym,
 * antonym, hypernym, part_of) fit content words: on saturated seed entries, the share of senses
 * with two published relations was noun 90%, adjective 75%, verb 72%, adverb 35%, and 11-28% for
 * function words. A sense with one neighbor is still a leaf of the network; two make it a junction.
 * A pronoun is a function word: a personal or relative pronoun's sense ("we", "who") has no
 * synonym or antonym in a learner's dictionary, and its relations closures kept failing over loose
 * candidates ("I" for the royal "we"). Zero means the sense has no relations gap and its relations
 * count no slot.
 */
export const RELATIONS_NEEDED: Readonly<Record<Pos, number>> = {
  noun: 2,
  verb: 2,
  adjective: 2,
  adverb: 1,
  pronoun: 0,
  determiner: 0,
  preposition: 0,
  conjunction: 0,
  interjection: 0,
  auxiliary: 0,
}

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
  preposition: 0,
  conjunction: 0,
  interjection: 0,
  auxiliary: 0,
}

/**
 * How many grammar facts a sense needs. Countability is what a learner most needs of a noun,
 * transitivity of a verb, position, patterns, or prepositions of an adjective, the usual position
 * of an adverb, and what a determiner or pronoun agrees with ("each" + a singular noun).
 */
export const GRAMMAR_NEEDED: Readonly<Record<Pos, number>> = {
  noun: 1,
  verb: 1,
  adjective: 1,
  adverb: 1,
  pronoun: 1,
  determiner: 1,
  preposition: 0,
  conjunction: 0,
  interjection: 0,
  auxiliary: 0,
}

/**
 * How many collocations a sense needs: content words, adverbs, and the function words a learner
 * meets in set combinations ("hardly any", "filled with", "both ... and"). A pronoun or
 * interjection combines freely.
 */
export const COLLOCATIONS_NEEDED: Readonly<Record<Pos, number>> = {
  noun: 1,
  verb: 1,
  adjective: 1,
  adverb: 1,
  pronoun: 0,
  determiner: 1,
  preposition: 1,
  conjunction: 1,
  interjection: 0,
  auxiliary: 0,
}

/**
 * The senses at the other end of the entry's relations that can show: their gloss and their
 * entry's fact are live. A relation to any other sense is hidden from the public view, so it fills
 * nothing.
 */
function visibleNeighbors({ senses, facts }: GapInput['neighbors']): ReadonlySet<string> {
  const live = new Set(facts.filter((fact) => isLive(fact.status)).map((fact) => `${fact.kind}:${fact.subjectId}`))
  return new Set(
    senses.filter((sense) => live.has(`sense:${sense.id}`) && live.has(`entry:${sense.entryId}`)).map(({ id }) => id),
  )
}

/** The relation links this sense to a sense that can show. */
function linksVisible(fact: FactOf<'relation'>, senseId: SenseId, visible: ReadonlySet<string>): boolean {
  if (fact.subjectId === senseId) return visible.has(fact.payload.target_sense_id)
  return fact.objectId === senseId && visible.has(fact.subjectId)
}

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
  /** `visible`: the neighbor senses a relation may link to and count. */
  fills: (fact: Fact, senseId: SenseId, visible: ReadonlySet<string>, state: EntryState) => boolean
  gap: (senseId: SenseId, filling: Fact[], state: EntryState) => SenseGap
  /** The gap a gap_closure fact on the sense closes, filling every slot of the rule; absent when none may. */
  closable?: ClosableGap
}

const senseGapRules: readonly SenseRule[] = [
  {
    need: (sense) => RELATIONS_NEEDED[sense.pos],
    fills: (fact, senseId, visible) => fact.kind === 'relation' && linksVisible(fact, senseId, visible),
    gap: (senseId, filling) => ({
      type: 'relations',
      sense_id: senseId,
      count: filling.length,
      have: relationsHave(filling.filter(isKind('relation')), senseId),
    }),
    closable: 'relations',
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
    fills: (fact, senseId, _visible, state) =>
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
  /** How many more live facts the gap needs to close. */
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

/** A live gap_closure fact on the node closes the gap: its slots count as filled. */
const closedBy = (live: readonly Fact[], gap: ClosableGap | undefined, subjectId: string) =>
  gap !== undefined &&
  live.filter(isKind('gap_closure')).some((fact) => fact.subjectId === subjectId && fact.payload.gap === gap)

/** The open gaps, and how many slots the rules count for the entry: each entry rule and, per counted sense, each need. */
function openGaps(snapshot: GapInput): {
  open: OpenGap[]
  slots: number
} {
  const live = [...snapshot.facts, ...snapshot.incoming].filter((fact) => isLive(fact.status))
  const glossed = new Set(live.flatMap((fact) => (fact.kind === 'sense' ? [fact.subjectId] : [])))
  const visible = visibleNeighbors(snapshot.neighbors)
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
  }
  const entry = entryGapRules.flatMap((rule) => {
    const missing = closedBy(live, rule.closable, snapshot.entry.id) ? 0 : rule.need(state) - rule.filled(state)
    return missing > 0 ? [{ gap: rule.gap(state), missing }] : []
  })
  const entrySlots = entryGapRules.reduce((need, rule) => need + rule.need(state), 0)
  const perSense = counted.flatMap((sense) =>
    senseGapRules.flatMap((rule) => {
      const filling = live.filter((fact) => rule.fills(fact, sense.id, visible, state))
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
  return openGaps(snapshot).open.map(({ gap }) => gap)
}

/**
 * The entry's live facts worth replacing: one that open feedback targets, one published on an
 * uncertain verdict, or one a review in place failed that stays published (a gloss, which a
 * correction replaces). Relations count on the entry their subject belongs to.
 */
export function weakFacts(snapshot: Pick<EntryFacts, 'facts' | 'flagged'>): WeakFact[] {
  return snapshot.facts
    .filter((fact) => isLive(fact.status))
    .flatMap((fact): WeakFact[] => {
      if (snapshot.flagged.has(fact.id)) return [{ id: fact.id, kind: fact.kind, reason: 'feedback' }]
      if (fact.status === 'published' && fact.review?.verdict === 'uncertain') {
        return [{ id: fact.id, kind: fact.kind, reason: 'uncertain' }]
      }
      if (fact.status === 'published' && fact.review?.verdict === 'fail') {
        return [{ id: fact.id, kind: fact.kind, reason: 'failed' }]
      }
      return []
    })
}

export interface EntryAssessment {
  gaps: Gap[]
  weakFacts: WeakFact[]
  /** Filled slots over the slots the gap rules count, 0..1; 1 exactly when there are no gaps. */
  completeness: number
  /** One minus weak facts over live facts about the entry, 0..1; 1 exactly when no fact is weak. */
  quality: number
  /**
   * Identifies the open work: the gaps, and each weak fact by kind, subject, and reason. A weak
   * fact replaced by a correction that is weak again keeps its key, so trading one for the other
   * is not a change.
   */
  openWork: string
  /**
   * A fact about the entry or its senses, or a relation into one of its senses, is pending. Its
   * review can still change the open work, so a pass now would race the verdict.
   */
  awaitingReview: boolean
}

/** Scores the entry from its live facts. Completeness derives from `entryGaps`, so the gap rules stay the one source. */
export function assessEntry(snapshot: EntryFacts): EntryAssessment {
  const { open, slots } = openGaps(snapshot)
  const missing = open.reduce((sum, { missing }) => sum + missing, 0)
  const weak = weakFacts(snapshot)
  const live = snapshot.facts.filter((fact) => isLive(fact.status)).length
  const subjects = new Map(snapshot.facts.map((fact) => [fact.id, fact.subjectId]))
  const weakSlots = weak.map((fact) => `${fact.kind}:${subjects.get(fact.id)}:${fact.reason}`).sort()
  const gaps = open.map(({ gap }) => gap)
  return {
    gaps,
    weakFacts: weak,
    completeness: 1 - missing / slots,
    quality: live === 0 ? 1 : 1 - weak.length / live,
    openWork: JSON.stringify({ gaps, weak: weakSlots }),
    awaitingReview: [...snapshot.facts, ...snapshot.incoming].some((fact) => fact.status === 'pending'),
  }
}

/** Whether the entry has work left: a gap or a weak fact. */
export const hasWork = (scores: { completeness: number; quality: number }) =>
  scores.completeness < 1 || scores.quality < 1

/** The worklist's last claim of an entry, as the stall rule reads it. */
export interface LastClaim {
  /** The open work when the entry was last claimed; null before its first claim. */
  openWork: string | null
  /** The holder completed that claim's pass. */
  completed: boolean
}

/**
 * A completed pass that left the open work as the claim found it made no progress, and another
 * pass would do the same: nothing it added stayed, or it added only what no gap needed. Such an
 * entry stays stalled while its open work is unchanged, so a review that rejects the pass's facts
 * stalls it as well. A new sense, another principal's fact, a fact leaving live, or feedback on a
 * fact changes the open work and lifts the stall. A lease that lapsed is not a completed pass.
 */
export const isStalled = (last: LastClaim, assessment: Pick<EntryAssessment, 'openWork'>) =>
  last.completed && last.openWork === assessment.openWork

/** The worklist state that admits an entry to a claim. */
export interface Admission {
  live: boolean
  /** A write changed the entry's facts since the stored scores were computed. */
  stale: boolean
  stalled: boolean
  awaitingReview: boolean
  completeness: number
  quality: number
}

/**
 * An entry is claimable while live with work left, not stalled, and not awaiting review. Waiting
 * for reviews to settle keeps a pass from recording open work that a verdict then undoes, which
 * would lift the stall the verdict should keep. Stale scores admit it, since the write that made
 * them stale may have opened work.
 */
export const isClaimable = (row: Admission) =>
  row.live && (row.stale || (!row.stalled && !row.awaitingReview && hasWork(row)))

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

const BANDS = 8

/**
 * Completeness from which an entry's remaining gaps are polish: past it, an entry waits behind every
 * less complete entry of every band, so the next level fills before this one is finished.
 */
export const POLISH_FROM = 0.95

/**
 * The claim tier, lowest first. Entries below POLISH_FROM come before entries being polished (a
 * few gaps left, or only weak facts), so filling comes before finishing and quality; within each,
 * by learner band; within a band,
 * never-claimed entries before claimed ones. Never-claimed entries go by highest frequency, then
 * lowest completeness; claimed entries by least recently claimed, so an entry whose lease keeps
 * lapsing goes behind every other claimed entry of its band.
 */
export const claimTier = (row: LearnerPriority & { completeness: number; claimed: boolean }) =>
  2 * ((row.completeness < POLISH_FROM ? 0 : BANDS) + learnerBand(row)) + (row.claimed ? 1 : 0)
