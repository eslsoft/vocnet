import type { FactStatus, Verdict } from '@shared/facts'

export type FactEvent = 'publish' | 'reject' | 'reconfirm' | 'invalidate' | 'supersede' | 'retract' | 'rereview'

/** The fact state machine. Every status write is conditional on `from`. */
export const factTransitions: Record<FactEvent, { from: readonly FactStatus[]; to: FactStatus }> = {
  publish: { from: ['pending'], to: 'published' },
  reject: { from: ['pending'], to: 'rejected' },
  // Revalidation re-reviews a published fact in place after the gloss it was judged against changed.
  reconfirm: { from: ['published'], to: 'published' },
  invalidate: { from: ['published'], to: 'rejected' },
  supersede: { from: ['published'], to: 'superseded' },
  retract: { from: ['pending', 'published'], to: 'retracted' },
  rereview: { from: ['published', 'rejected'], to: 'pending' },
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

export type ReviewEvent = 'publish' | 'reject' | 'reconfirm' | 'invalidate'

const verdictEvents: Record<ReviewMode, Record<Verdict, ReviewEvent>> = {
  review: { pass: 'publish', uncertain: 'publish', fail: 'reject' },
  revalidation: { pass: 'reconfirm', uncertain: 'reconfirm', fail: 'invalidate' },
}

/** Publish with flaws, correct later: only a failing review rejects, and only it unpublishes. */
export function decide(mode: ReviewMode, verdict: Verdict): ReviewEvent {
  return verdictEvents[mode][verdict]
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
