import { CURATOR, type Review } from '@shared/facts'
import type { FactEvent } from './fact-lifecycle'
import { type Principal, principalRef } from './principal'

export type CuratorVerdict = 'pass' | 'fail'

export const curationEvents: Record<CuratorVerdict, FactEvent> = { pass: 'curate_pass', fail: 'curate_fail' }

/** The review a curator's verdict records: certain, with the curator's reason, and the curator as its model. */
export function curatorReview(principal: Principal, verdict: CuratorVerdict, reason: string, at: string): Review {
  return {
    reviewer: CURATOR,
    model: principalRef(principal),
    verdict,
    confidence: 1,
    reason,
    context: {},
    detail: {},
    reviewed_at: at,
  }
}

/**
 * A curator settled the fact. Its verdict is final for the rules: no revalidation marks it, and
 * only a curator supersedes, retracts, or resubmits it.
 */
export const isCurated = (fact: { review: Review | null }) => fact.review?.reviewer === CURATOR
