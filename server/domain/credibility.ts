import { CURATOR, type FactKind } from '@shared/facts'
import type { OptionalGap } from '@shared/work'
import type { Fact } from './fact'

/**
 * How a published fact was settled: by a curator, by a decision model alone (Jev, luna, or both),
 * by the LLM after a decision model did not settle it, or by the LLM alone.
 */
export type ReviewPath = 'curator' | 'decision' | 'decision_llm' | 'llm'

export function reviewPath(fact: Pick<Fact, 'review'>): ReviewPath | null {
  const reviewer = fact.review?.reviewer
  if (reviewer === undefined) return null
  if (reviewer === CURATOR) return 'curator'
  if (reviewer === 'llm') return 'llm'
  return reviewer.endsWith('+llm') ? 'decision_llm' : 'decision'
}

/**
 * The share of facts of a kind that a path settles correctly, as audits measured it. A curator is
 * trusted; a decision model's own pass held 35 of 35 audited facts and every audited translation
 * pass; the LLM over an unsure decision model was right 46 of 52 times. The LLM alone is measured
 * per kind against hand labels (2026-11-11 evaluations). Audits update these numbers.
 */
const DECISION = 0.97
const DECISION_LLM = 0.88

const LLM_ALONE: Readonly<Record<FactKind, number>> = {
  senses: 0.7,
  form: 0.88,
  relation: 0.77,
  pronunciation: 0.92,
  example: 0.9,
  translation: 0.93,
  topic: 0.95,
  grammar: 0.88,
  morphology: 0.99,
  collocation: 0.97,
  syllables: 0.96,
  phrases: 0.88,
}

/** The credibility of a live fact: how often its kind and path are right. A pending fact has none yet. */
export function factCredibility(fact: Pick<Fact, 'kind' | 'review'>): number | null {
  const path = reviewPath(fact)
  if (path === null) return null
  if (path === 'curator') return 1
  if (path === 'decision') return DECISION
  if (path === 'decision_llm') return DECISION_LLM
  return LLM_ALONE[fact.kind]
}

/**
 * An optional slot a pass completed without a value claims the slot is empty, which nobody
 * reviewed: it ranks low so audits reach it.
 */
const EMPTY_PASS = 0.8

export const passCredibility = (_gap: OptionalGap): number => EMPTY_PASS
