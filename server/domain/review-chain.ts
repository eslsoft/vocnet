import type { ReviewerChain, ReviewerKind, Verdict } from '@shared/facts'
import type { DecisionModel, DecisionRequest } from './fact-kinds'

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

/** A decision model's answers to the request's questions, each from 0 to 1. */
export interface DecisionAnswers {
  model: string
  answers: Record<string, number>
}

/** Below this a decision model's score reads as a fail in the record; it never settles one. */
export const DECISION_FAIL_BELOW = 0.5

/** A model's score is its lowest answer: every question must hold. */
export const scoreOf = ({ answers }: DecisionAnswers) => Math.min(...Object.values(answers))

/** The opinion a decision model's answers record: its score against its pass threshold. */
export function decisionOpinion(reviewer: DecisionModel, passAt: number, answers: DecisionAnswers): Opinion {
  const score = scoreOf(answers)
  const verdict: Verdict = score >= passAt ? 'pass' : score < DECISION_FAIL_BELOW ? 'fail' : 'uncertain'
  const listed = Object.entries(answers.answers)
    .map(([key, value]) => `${key}=${Math.round(value * 100) / 100}`)
    .join(', ')
  return {
    reviewer,
    model: answers.model,
    verdict,
    confidence: score,
    reason: `${reviewer === 'jev' ? 'Jev' : 'luna'} ${listed}`,
    detail: { answers: answers.answers },
  }
}

/**
 * Whether the decision models settle a pass: every model reaches its threshold (min), at least one
 * does (any), or their mean score reaches the mean of their thresholds (mean). Anything else is
 * left to the LLM.
 */
export function decisionSettles(request: DecisionRequest, scores: ReadonlyMap<DecisionModel, number>): boolean {
  const passAt = (model: DecisionModel) => request.passAt[model] ?? 1
  const reached = request.models.map((model) => (scores.get(model) ?? 0) >= passAt(model))
  if (request.combine === 'any') return reached.some(Boolean)
  if (request.combine === 'min') return reached.every(Boolean)
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  return mean(request.models.map((model) => scores.get(model) ?? 0)) >= mean(request.models.map(passAt))
}

/**
 * The recorded review: a settled pass carries the decision models' combined score; otherwise the
 * LLM's verdict decides. A chain of one keeps its reviewer's raw detail; a longer one keeps every
 * opinion.
 */
export function chainVerdict(opinions: readonly [Opinion, ...Opinion[]], settled?: number): ChainVerdict {
  const final = opinions[opinions.length - 1] as Opinion
  if (opinions.length === 1) return final
  const reviewer = opinions.map((opinion) => opinion.reviewer).join('+') as ReviewerChain
  if (settled !== undefined) {
    return {
      reviewer,
      model: opinions.map((opinion) => opinion.model).join('+'),
      verdict: 'pass',
      confidence: settled,
      reason: opinions.map((opinion) => opinion.reason).join(' | '),
      detail: { opinions },
    }
  }
  return {
    reviewer,
    model: opinions.map((opinion) => opinion.model).join('+'),
    verdict: final.verdict,
    confidence: final.confidence,
    reason: opinions.map((opinion) => opinion.reason).join(' | '),
    detail: { opinions },
  }
}
