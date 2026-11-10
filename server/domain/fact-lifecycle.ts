import type { FactStatus, Verdict } from '@shared/facts'

export type FactEvent =
  | 'publish'
  | 'reject'
  | 'reconfirm'
  | 'invalidate'
  | 'flag'
  | 'release'
  | 'supersede'
  | 'retract'
  | 'rereview'
  | 'curate_pass'
  | 'curate_fail'

/** The fact state machine. Every status write is conditional on `from`. */
export const factTransitions: Record<FactEvent, { from: readonly FactStatus[]; to: FactStatus }> = {
  publish: { from: ['pending'], to: 'published' },
  reject: { from: ['pending'], to: 'rejected' },
  // Revalidation re-reviews a published fact in place after the gloss it was judged against changed.
  reconfirm: { from: ['published'], to: 'published' },
  invalidate: { from: ['published'], to: 'rejected' },
  // A failed revalidation of a fact whose rejection would hide what was judged against it.
  flag: { from: ['published'], to: 'published' },
  release: { from: ['published'], to: 'published' },
  supersede: { from: ['published'], to: 'superseded' },
  retract: { from: ['pending', 'published'], to: 'retracted' },
  rereview: { from: ['published', 'rejected'], to: 'pending' },
  // A curator's verdict replaces the reviewer chain's. A rejected fact a curator passes is first
  // revived through `rereview`, whose write carries the live-slot rules, and then passed.
  curate_pass: { from: ['pending', 'published'], to: 'published' },
  curate_fail: { from: ['pending', 'published'], to: 'rejected' },
}

export function canApply(event: FactEvent, status: FactStatus): boolean {
  return factTransitions[event].from.includes(status)
}

/** Live facts occupy their content key: they are visible now or may become visible. */
export function isLive(status: FactStatus): boolean {
  return status === 'pending' || status === 'published'
}

/** What a review decides: a pending fact's first review, or a published fact's revalidation. */
export type ReviewMode = 'review' | 'revalidation'

export type ReviewEvent = 'publish' | 'reject' | 'reconfirm' | 'invalidate' | 'flag' | 'release'

/**
 * What a failed revalidation does to a kind's fact: `invalidate` rejects it; `flag` keeps it
 * published with the failing review, a weak fact its producer corrects.
 */
export type RevalidationFailure = 'invalidate' | 'flag'

/** What a review found: the reviewer's verdict, or that the fact's context leaves nothing to judge. */
export type ReviewFinding = Verdict | 'unreviewable'

const findingEvents: Record<ReviewMode, Record<ReviewFinding, ReviewEvent>> = {
  review: { pass: 'publish', uncertain: 'publish', fail: 'reject', unreviewable: 'reject' },
  // No reviewer judged a dependent whose gloss vanished, so it keeps its standing review.
  revalidation: { pass: 'reconfirm', uncertain: 'reconfirm', fail: 'invalidate', unreviewable: 'release' },
}

/**
 * Publish with flaws, correct later: only a failing review rejects, and only it unpublishes. A
 * kind that flags a failed revalidation stays published instead, for a correction to replace.
 */
export function decide(
  mode: ReviewMode,
  finding: ReviewFinding,
  onFailedRevalidation: RevalidationFailure = 'invalidate',
): ReviewEvent {
  const event = findingEvents[mode][finding]
  return event === 'invalidate' && onFailedRevalidation === 'flag' ? 'flag' : event
}

/** The status each review event reports, and whether it records the new review on the fact. */
export const reviewEffects: Record<ReviewEvent, { outcome: 'published' | 'rejected'; records: boolean }> = {
  publish: { outcome: 'published', records: true },
  reject: { outcome: 'rejected', records: true },
  reconfirm: { outcome: 'published', records: true },
  invalidate: { outcome: 'rejected', records: true },
  flag: { outcome: 'published', records: true },
  release: { outcome: 'published', records: false },
}

/** A pending fact awaits its review; a published fact marked for revalidation awaits a new one. */
export function reviewModeOf(fact: { status: FactStatus; revalidateSince: string | null }): ReviewMode | null {
  if (fact.status === 'pending') return 'review'
  if (fact.status === 'published' && fact.revalidateSince !== null) return 'revalidation'
  return null
}

// Uncertain facts still publish, so the band starts where an answer is more likely true than false.
export const JEV_POLICY = { version: 'canonical-jev-2', passAt: 0.8, failBelow: 0.5 } as const

/** Every answer at or above passAt is `pass`; any below failBelow is `fail`; confidence is the weakest answer. */
export function jevVerdict(answers: Record<string, number>): { verdict: Verdict; confidence: number } {
  const values = Object.values(answers)
  const confidence = Math.min(...values)
  if (values.some((value) => value < JEV_POLICY.failBelow)) return { verdict: 'fail', confidence }
  if (values.every((value) => value >= JEV_POLICY.passAt)) return { verdict: 'pass', confidence }
  return { verdict: 'uncertain', confidence }
}
