import type { FactStatus, Verdict } from '@shared/facts'

export type FactEvent = 'publish' | 'reject' | 'supersede' | 'retract' | 'rereview' | 'curate_pass' | 'curate_fail'

/** The fact state machine. Every status write is conditional on `from`. */
export const factTransitions: Record<FactEvent, { from: readonly FactStatus[]; to: FactStatus }> = {
  publish: { from: ['pending'], to: 'published' },
  reject: { from: ['pending'], to: 'rejected' },
  supersede: { from: ['published'], to: 'superseded' },
  retract: { from: ['pending', 'published'], to: 'retracted' },
  // A rejected fact a curator passes is first revived through `rereview`, whose write carries the
  // live-slot rules, and then passed.
  rereview: { from: ['rejected'], to: 'pending' },
  // A curator's verdict replaces the reviewer chain's.
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

export type ReviewEvent = 'publish' | 'reject'

/** What a review found: the reviewer's verdict, or that the fact's context leaves nothing to judge. */
export type ReviewFinding = Verdict | 'unreviewable'

/**
 * Publish with flaws, correct later: a pending fact is reviewed once, and only a failing review
 * (or a context that leaves nothing to judge) rejects it.
 */
export function decide(finding: ReviewFinding): ReviewEvent {
  return finding === 'fail' || finding === 'unreviewable' ? 'reject' : 'publish'
}
