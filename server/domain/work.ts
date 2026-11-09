import { type EntryId, type FactId, type Pos, relationTypeSchema, type SenseId } from '@shared/facts'
import type { Gap, WeakFact, WorkLeaseId } from '@shared/work'
import { type Fact, type FactOf, isKind } from './fact'
import { isLive } from './fact-lifecycle'
import type { SenseNode } from './nodes'
import type { PrincipalRef } from './principal'
import { isMultiword } from './term'

/** What the work rules read about an entry: its senses, its facts in every status, and its open feedback. */
export interface EntryFacts {
  entry: { lemma: string }
  senses: readonly SenseNode[]
  /** Facts whose subject is the entry or one of its senses. */
  facts: Fact[]
  /** Relation facts whose object is one of the entry's senses. */
  incoming: Fact[]
  /** Facts that an open or claimed feedback item targets. */
  flagged: ReadonlySet<FactId>
}

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

type EntryGap = Extract<Gap, { type: 'senses' | 'forms' | 'pronunciation' | 'morphology' }>
type SenseGap = Exclude<Gap, EntryGap>
type RelationGap = Extract<Gap, { type: 'relations' }>

const isChinese = (language: string) => language === 'zh' || language.startsWith('zh-')

// A gap is open while fewer live facts fill it than it needs. The input facts are the entry's own
// (about the entry or its senses) plus relations pointing at its senses, so a kind check scopes to the entry.
const entryGapRules: ReadonlyArray<{ gap: EntryGap; need: (lemma: string) => number; fills: (fact: Fact) => boolean }> =
  [
    { gap: { type: 'senses' }, need: () => 1, fills: (fact) => fact.kind === 'sense' },
    { gap: { type: 'forms' }, need: () => 1, fills: (fact) => fact.kind === 'form' },
    { gap: { type: 'pronunciation' }, need: () => 1, fills: (fact) => fact.kind === 'pronunciation' },
    // Word formation analyses one word; a phrase's parts are its own entries.
    {
      gap: { type: 'morphology' },
      need: (lemma) => (isMultiword(lemma) ? 0 : 1),
      fills: (fact) => fact.kind === 'morphology',
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
 * Zero means the sense has no relations gap and its relations count no slot.
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
 * How many live topic facts a sense of each part of speech needs. Nouns, verbs, and adjectives name
 * the things, actions, and qualities a scene is made of; adverbs may be tagged but need no topic,
 * and function words belong to no scene. Zero means the sense has no topics gap.
 */
export const TOPICS_NEEDED: Readonly<Record<Pos, number>> = {
  noun: 1,
  verb: 1,
  adjective: 1,
  adverb: 0,
  pronoun: 0,
  determiner: 0,
  preposition: 0,
  conjunction: 0,
  interjection: 0,
  auxiliary: 0,
}

/**
 * How many grammar facts a sense needs. Countability is what a learner most needs of a noun, and
 * transitivity of a verb; an adjective's position and patterns are worth recording where they
 * restrict it, so it may have a grammar fact but has no gap.
 */
export const GRAMMAR_NEEDED: Readonly<Record<Pos, number>> = {
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

/** How many collocations a sense needs: content words that combine with other words in set ways. */
export const COLLOCATIONS_NEEDED: Readonly<Record<Pos, number>> = {
  noun: 1,
  verb: 1,
  adjective: 1,
  adverb: 0,
  pronoun: 0,
  determiner: 0,
  preposition: 0,
  conjunction: 0,
  interjection: 0,
  auxiliary: 0,
}

const senseGapRules: ReadonlyArray<{
  need: (sense: SenseNode) => number
  fills: (fact: Fact, senseId: SenseId) => boolean
  gap: (senseId: SenseId, filling: Fact[]) => SenseGap
}> = [
  {
    need: (sense) => RELATIONS_NEEDED[sense.pos],
    fills: (fact, senseId) => fact.kind === 'relation' && (fact.subjectId === senseId || fact.objectId === senseId),
    gap: (senseId, filling) => ({
      type: 'relations',
      sense_id: senseId,
      count: filling.length,
      have: relationsHave(filling.filter(isKind('relation')), senseId),
    }),
  },
  {
    need: () => 1,
    fills: (fact, senseId) => fact.kind === 'example' && fact.subjectId === senseId,
    gap: (senseId) => ({ type: 'examples', sense_id: senseId }),
  },
  {
    need: () => 1,
    fills: (fact, senseId) =>
      fact.kind === 'translation' && fact.subjectId === senseId && isChinese(fact.payload.language),
    gap: (senseId) => ({ type: 'translations', sense_id: senseId, language: 'zh' }),
  },
  {
    need: (sense) => TOPICS_NEEDED[sense.pos],
    fills: (fact, senseId) => fact.kind === 'topic' && fact.subjectId === senseId,
    gap: (senseId) => ({ type: 'topics', sense_id: senseId }),
  },
  {
    need: (sense) => GRAMMAR_NEEDED[sense.pos],
    fills: (fact, senseId) => fact.kind === 'grammar' && fact.subjectId === senseId,
    gap: (senseId) => ({ type: 'grammar', sense_id: senseId }),
  },
  {
    need: (sense) => COLLOCATIONS_NEEDED[sense.pos],
    fills: (fact, senseId) => fact.kind === 'collocation' && fact.subjectId === senseId,
    gap: (senseId) => ({ type: 'collocations', sense_id: senseId }),
  },
]

interface OpenGap {
  gap: Gap
  /** How many more live facts the gap needs to close. */
  missing: number
}

/** The open gaps, and how many slots the rules count for the entry: each entry rule and, per live sense, each need. */
function openGaps(snapshot: Pick<EntryFacts, 'entry' | 'senses' | 'facts' | 'incoming'>): {
  open: OpenGap[]
  slots: number
} {
  const live = [...snapshot.facts, ...snapshot.incoming].filter((fact) => isLive(fact.status))
  const glossed = new Set(live.flatMap((fact) => (fact.kind === 'sense' ? [fact.subjectId] : [])))
  const liveSenses = snapshot.senses.filter((sense) => glossed.has(sense.id))
  const { lemma } = snapshot.entry
  const entry = entryGapRules.flatMap((rule) => {
    const missing = rule.need(lemma) - live.filter(rule.fills).length
    return missing > 0 ? [{ gap: rule.gap, missing }] : []
  })
  const entrySlots = entryGapRules.reduce((need, rule) => need + rule.need(lemma), 0)
  const senses = liveSenses.flatMap((sense) =>
    senseGapRules.flatMap((rule) => {
      const filling = live.filter((fact) => rule.fills(fact, sense.id))
      const missing = rule.need(sense) - filling.length
      return missing > 0 ? [{ gap: rule.gap(sense.id, filling), missing }] : []
    }),
  )
  const senseSlots = liveSenses.reduce(
    (sum, sense) => sum + senseGapRules.reduce((need, rule) => need + rule.need(sense), 0),
    0,
  )
  return { open: [...entry, ...senses], slots: entrySlots + senseSlots }
}

/** What the entry still lacks, judged from its live facts. A sense counts while its gloss fact is live. */
export function entryGaps(snapshot: Pick<EntryFacts, 'entry' | 'senses' | 'facts' | 'incoming'>): Gap[] {
  return openGaps(snapshot).open.map(({ gap }) => gap)
}

/**
 * The entry's live facts worth replacing: one that open feedback targets, or one published on an
 * uncertain verdict. Relations count on the entry their subject belongs to.
 */
export function weakFacts(snapshot: Pick<EntryFacts, 'facts' | 'flagged'>): WeakFact[] {
  return snapshot.facts
    .filter((fact) => isLive(fact.status))
    .flatMap((fact): WeakFact[] => {
      if (snapshot.flagged.has(fact.id)) return [{ id: fact.id, kind: fact.kind, reason: 'feedback' }]
      if (fact.status === 'published' && fact.review?.verdict === 'uncertain') {
        return [{ id: fact.id, kind: fact.kind, reason: 'uncertain' }]
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
 * The claim tier, lowest first. Entries with a gap come before entries whose only work is weak
 * facts, so completeness comes before quality; within each, by learner band; within a band,
 * never-claimed entries before claimed ones. Never-claimed entries go by highest frequency, then
 * lowest completeness; claimed entries by least recently claimed, so an entry whose lease keeps
 * lapsing goes behind every other claimed entry of its band.
 */
export const claimTier = (row: LearnerPriority & { completeness: number; claimed: boolean }) =>
  2 * ((row.completeness < 1 ? 0 : BANDS) + learnerBand(row)) + (row.claimed ? 1 : 0)
