import type { ReviewerChain, ReviewerKind, Verdict } from '@shared/facts'
import type { ReviewRequest } from './fact-kinds'

/** What one reviewer said about a fact. */
export interface Opinion {
  reviewer: ReviewerKind
  model: string
  verdict: Verdict
  confidence: number
  reason: string
  detail: Record<string, unknown>
}

/** The review a chain of opinions records on the fact. */
export type ChainVerdict = Omit<Opinion, 'reviewer'> & { reviewer: ReviewerChain }

/**
 * Whether a reviewer's opinion settles the fact when another reviewer follows it in the chain.
 * Jev's pass is reliable unless the request keeps the pass for the LLM, whose rubric holds rules
 * Jev's question does not; its fail and uncertain bands misjudge often enough that the LLM decides
 * them, unless the request sets a floor its answer falls under. The last reviewer in a chain, the
 * LLM, settles whatever it says.
 */
export function settles(request: ReviewRequest, opinion: Opinion): boolean {
  if (request.reviewer === 'llm') return true
  if (opinion.verdict === 'pass') return request.settlesPass ?? true
  return opinion.confidence < (request.settlesFailBelow ?? 0)
}

/** The last opinion decides. A chain of one keeps its reviewer's raw detail; a longer one keeps every opinion. */
export function chainVerdict(opinions: readonly [Opinion, ...Opinion[]]): ChainVerdict {
  const final = opinions[opinions.length - 1] as Opinion
  if (opinions.length === 1) return final
  return {
    reviewer: opinions.map((opinion) => opinion.reviewer).join('+') as ReviewerChain,
    model: opinions.map((opinion) => opinion.model).join('+'),
    verdict: final.verdict,
    confidence: final.confidence,
    reason: opinions.map((opinion) => opinion.reason).join(' | '),
    detail: { opinions },
  }
}
