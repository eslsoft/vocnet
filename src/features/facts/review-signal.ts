import type { FactDto } from '@shared/facts'

/**
 * How much to trust a fact at a glance. "Published with flaws" is the core concept the
 * admin watches, so a pass below this confidence is flagged like an uncertain verdict.
 */
export const CONFIDENT_AT = 0.8

export type ReviewSignal = 'unreviewed' | 'confident' | 'flagged' | 'failed'

export function reviewSignal(fact: Pick<FactDto, 'review'>): ReviewSignal {
  const { review } = fact
  if (!review) return 'unreviewed'
  if (review.verdict === 'fail') return 'failed'
  if (review.verdict === 'uncertain' || review.confidence < CONFIDENT_AT) return 'flagged'
  return 'confident'
}
