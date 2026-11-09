import type { FactStatus, Verdict } from '@shared/facts'

export type FactEvent = 'publish' | 'reject' | 'supersede' | 'retract' | 'rereview'

/** The fact state machine. Every status write is conditional on `from`. */
export const factTransitions: Record<FactEvent, { from: readonly FactStatus[]; to: FactStatus }> = {
  publish: { from: ['pending'], to: 'published' },
  reject: { from: ['pending'], to: 'rejected' },
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

const verdictEvents: Record<Verdict, 'publish' | 'reject'> = {
  pass: 'publish',
  uncertain: 'publish',
  fail: 'reject',
}

/** Publish with flaws, correct later: only a failing review rejects. */
export function decide(verdict: Verdict): 'publish' | 'reject' {
  return verdictEvents[verdict]
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
