import { type EntryId, relationTypeSchema, type SenseId } from '@shared/facts'
import type { Gap, WorkLeaseId } from '@shared/work'
import type { EntrySnapshot } from './catalog-view'
import { type Fact, type FactOf, isKind } from './fact'
import { isLive } from './fact-lifecycle'
import type { PrincipalRef } from './principal'

export interface WorkLease {
  id: WorkLeaseId
  entryId: EntryId
  holder: PrincipalRef
  /** When this lease's claim was made, which starts the pass. */
  claimedAt: string
  /** Claims in a row that took the entry ahead of the rotation, this one included. */
  revisitStreak: number
  expiresAt: string
}

/**
 * How many claims in a row an entry can take ahead of the rotation. Only a claim from the rotation
 * resets the streak, so an entry costs at most this many extra claims before every never-claimed
 * entry outside the seed list is reached, whatever its passes or reviews do.
 */
export const MAX_REVISIT_STREAK = 3

/** Whether anything may still mark the entry to revisit after this claim. */
export const canRevisit = (revisitStreak: number) => revisitStreak < MAX_REVISIT_STREAK

export function leaseExpiry(now: Date, leaseSeconds: number): string {
  return new Date(now.getTime() + leaseSeconds * 1000).toISOString()
}

/** Only the holder completes its lease, and only before it expires. */
export function completeDecision(lease: WorkLease, who: PrincipalRef, now: Date): 'allowed' | 'not_holder' | 'expired' {
  if (lease.holder !== who) return 'not_holder'
  return Date.parse(lease.expiresAt) <= now.getTime() ? 'expired' : 'allowed'
}

type EntryGap = Extract<Gap, { type: 'senses' | 'forms' | 'pronunciation' }>
type SenseGap = Exclude<Gap, EntryGap>
type RelationGap = Extract<Gap, { type: 'relations' }>

const isChinese = (language: string) => language === 'zh' || language.startsWith('zh-')

// A gap is open while fewer live facts fill it than it needs. The input facts are the entry's own
// (about the entry or its senses) plus relations pointing at its senses, so a kind check scopes to the entry.
const entryGapRules: ReadonlyArray<{ gap: EntryGap; fills: (fact: Fact) => boolean }> = [
  { gap: { type: 'senses' }, fills: (fact) => fact.kind === 'sense' },
  { gap: { type: 'forms' }, fills: (fact) => fact.kind === 'form' },
  { gap: { type: 'pronunciation' }, fills: (fact) => fact.kind === 'pronunciation' },
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

const senseGapRules: ReadonlyArray<{
  need: number
  fills: (fact: Fact, senseId: SenseId) => boolean
  gap: (senseId: SenseId, filling: Fact[]) => SenseGap
}> = [
  {
    // A sense with one neighbor is still a leaf of the network; two make it a junction.
    need: 2,
    fills: (fact, senseId) => fact.kind === 'relation' && (fact.subjectId === senseId || fact.objectId === senseId),
    gap: (senseId, filling) => ({
      type: 'relations',
      sense_id: senseId,
      count: filling.length,
      have: relationsHave(filling.filter(isKind('relation')), senseId),
    }),
  },
  {
    need: 1,
    fills: (fact, senseId) => fact.kind === 'example' && fact.subjectId === senseId,
    gap: (senseId) => ({ type: 'examples', sense_id: senseId }),
  },
  {
    need: 1,
    fills: (fact, senseId) =>
      fact.kind === 'translation' && fact.subjectId === senseId && isChinese(fact.payload.language),
    gap: (senseId) => ({ type: 'translations', sense_id: senseId, language: 'zh' }),
  },
]

/** What the entry still lacks, judged from its live facts. A sense counts while its gloss fact is live. */
export function entryGaps(snapshot: Pick<EntrySnapshot, 'senses' | 'facts' | 'incoming'>): Gap[] {
  const live = [...snapshot.facts, ...snapshot.incoming].filter((fact) => isLive(fact.status))
  const glossed = new Set(live.flatMap((fact) => (fact.kind === 'sense' ? [fact.subjectId] : [])))
  const liveSenses = snapshot.senses.map((sense) => sense.id).filter((id) => glossed.has(id))
  const entry = entryGapRules.filter((rule) => !live.some(rule.fills)).map((rule) => rule.gap)
  const senses = liveSenses.flatMap((senseId) =>
    senseGapRules.flatMap((rule) => {
      const filling = live.filter((fact) => rule.fills(fact, senseId))
      return filling.length < rule.need ? [rule.gap(senseId, filling)] : []
    }),
  )
  return [...entry, ...senses]
}

const gapKey = (gap: Gap) => `${gap.type}:${'sense_id' in gap ? gap.sense_id : ''}`
const gapFill = (gap: Gap) => (gap.type === 'relations' ? gap.count : 0)

/**
 * Whether a finished pass earns the entry a revisit ahead of the rotation: the streak allows it, gaps
 * are still open, and the holder's facts since the claim closed a gap that was open without them or
 * raised its count. Facts that fill no open gap, such as another example where one exists, and gaps
 * the pass itself opened, such as a new sense's, are not progress: a pass that only adds those, or
 * nothing, as on a function word whose relations gap no agent can fill, would do the same next time.
 */
export function revisitAfterPass(
  snapshot: Pick<EntrySnapshot, 'senses' | 'facts' | 'incoming'>,
  pass: Pick<WorkLease, 'holder' | 'claimedAt' | 'revisitStreak'>,
): boolean {
  if (!canRevisit(pass.revisitStreak)) return false
  const after = new Map(entryGaps(snapshot).map((gap) => [gapKey(gap), gap]))
  if (after.size === 0) return false
  const before = (fact: Fact) => fact.author !== pass.holder || fact.createdAt < pass.claimedAt
  const open = entryGaps({
    senses: snapshot.senses,
    facts: snapshot.facts.filter(before),
    incoming: snapshot.incoming.filter(before),
  })
  return open.some((gap) => {
    const now = after.get(gapKey(gap))
    return now === undefined || gapFill(now) > gapFill(gap)
  })
}
