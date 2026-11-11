import type { FactDto } from '@shared/facts'

/**
 * How an admin reads a fact at a glance. A published fact whose review was uncertain is flagged,
 * one a review failed in place stays published as review failed; both are worth replacing.
 */
export type FactState = 'published' | 'flagged' | 'failed' | 'pending' | 'rejected' | 'superseded' | 'retracted'

export function factState(fact: Pick<FactDto, 'status' | 'review'>): FactState {
  if (fact.status !== 'published') return fact.status
  if (fact.review?.verdict === 'uncertain') return 'flagged'
  if (fact.review?.verdict === 'fail') return 'failed'
  return 'published'
}
