import { type Classification, classificationOf, classifiedSubjectOf } from '@server/domain/fact-kinds'
import { CLASSIFIER, principalRef } from '@server/domain/principal'
import { CLASSIFIED_TYPES, classifiedSlots, leaseExpiry, type WorkItem } from '@server/domain/work'
import type { FactKind, Review, SubmitFactInput } from '@shared/facts'
import { ExpectedError } from './errors'
import { type Actor, type SubmitDeps, submitFact } from './facts'
import { ReviewerProtocolError } from './ports'
import { refreshEntries } from './refresh'
import { loadSubject, type ReviewDeps } from './review'

export type ClassifyDeps = SubmitDeps & ReviewDeps

/** Items one lease classifies; their decision-model calls share the per-model caps. */
export const CLASSIFY_BATCH = 50
const LEASE_SECONDS = 900

export interface ClassifyTally {
  items: number
  /** Facts published on the decision model's scores alone. */
  decided: number
  /** Facts the LLM chose because the scores did not settle them. */
  chosen: number
  /** Slots a write rule refused; the item's pass records why. */
  refused: number
}

const EMPTY: ClassifyTally = { items: 0, decided: 0, chosen: 0, refused: 0 }
const add = (a: ClassifyTally, b: ClassifyTally): ClassifyTally => ({
  items: a.items + b.items,
  decided: a.decided + b.decided,
  chosen: a.chosen + b.chosen,
  refused: a.refused + b.refused,
})

/**
 * Works the items the server classifies itself (`CLASSIFIED_TYPES`), a lease at a time in queue
 * order, until none is free or `budgetMs` has passed. New entries and changed inventories open such
 * items on their rescore, so every run classifies whatever is open. A reviewer transport or protocol
 * failure ends the run with its lease's unworked items released, to be classified on a later run.
 */
export async function classifyWork(deps: ClassifyDeps, traceId: string, budgetMs: number): Promise<ClassifyTally> {
  const started = deps.clock.now().getTime()
  let tally = EMPTY
  while (deps.clock.now().getTime() - started < budgetMs) {
    const batch = await classifyBatch(deps, { principal: CLASSIFIER, traceId })
    if (!batch) break
    tally = add(tally, batch)
  }
  return tally
}

async function classifyBatch(deps: ClassifyDeps, actor: Actor): Promise<ClassifyTally | null> {
  const now = deps.clock.now()
  const claimed = await deps.work.claim(
    { id: deps.ids.lease(), holder: principalRef(actor.principal), expiresAt: leaseExpiry(now, LEASE_SECONDS) },
    CLASSIFIED_TYPES,
    CLASSIFY_BATCH,
    now.toISOString(),
  )
  if (!claimed) return null
  const results = await Promise.allSettled(claimed.items.map((item) => classifyItem(deps, actor, item)))
  const worked = claimed.items.flatMap((item, at) => {
    const result = results[at]
    return result?.status === 'fulfilled'
      ? [{ id: item.id, note: result.value.note, foundNone: false, blockedOn: [] }]
      : []
  })
  await deps.work.complete(claimed.lease, worked, deps.clock.now().toISOString())
  await refreshEntries(deps, [...claimed.lease.entryIds])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
  return results.reduce((tally, result) => (result.status === 'fulfilled' ? add(tally, result.value.tally) : tally), {
    ...EMPTY,
    items: worked.length,
  })
}

/** Classifies every slot the item names and submits each as a decided fact; the note says what happened. */
async function classifyItem(
  deps: ClassifyDeps,
  actor: Actor,
  item: WorkItem,
): Promise<{ note: string; tally: ClassifyTally }> {
  const { kind, slots } = classifiedSlots(item.gap)
  const subject = await loadSubject(deps, classifiedSubjectOf(kind), item.subjectId)
  const notes: string[] = []
  let tally = EMPTY
  for (const slot of slots) {
    const classification = classificationOf(kind, slot, subject as never)
    if (!classification) {
      notes.push(`${slot}: nothing to classify`)
      continue
    }
    const { payload, review } = await decide(deps, classification)
    const input = { kind, subject_id: item.subjectId, payload } as SubmitFactInput
    try {
      await submitFact(deps, actor, input, review)
      const how = review.reviewer === 'jev' ? 'decided' : 'chosen'
      tally = add(tally, { ...EMPTY, [how]: 1 })
      notes.push(`${slot}: ${review.reason}`)
    } catch (error) {
      // A write rule refused it (a rejected claim, a taken slot): the pass records why.
      if (!(error instanceof ExpectedError)) throw error
      tally = add(tally, { ...EMPTY, refused: 1 })
      notes.push(`${slot}: refused, ${error.message}`)
    }
  }
  return { note: notes.join('; '), tally }
}

/**
 * The payload the decision model's scores pick, reviewed by it when every chosen score reaches the
 * pass score; otherwise the LLM's choice, reviewed by the chain that made it.
 */
async function decide<K extends FactKind>(
  deps: ClassifyDeps,
  classification: Classification<K>,
): Promise<{ payload: unknown; review: Review }> {
  const at = deps.clock.now().toISOString()
  if (!classification.decision) {
    const { model, answer } = await deps.llm.answer(classification.prompt)
    const chosen = classification.parse(answer)
    if (!chosen) throw new ReviewerProtocolError('The LLM answered a classification outside its contract.')
    return {
      payload: chosen.payload,
      review: {
        reviewer: 'llm',
        model,
        verdict: 'pass',
        confidence: chosen.confidence,
        reason: chosen.reason,
        context: classification.state,
        detail: { llm: answer as Record<string, unknown> },
        reviewed_at: at,
      },
    }
  }
  const jev = await deps.decision.jev.ask(classification.decision.questions, classification.state)
  const picked = classification.decision.pick(jev.answers)
  if (picked.settled) {
    return {
      payload: picked.payload,
      review: {
        reviewer: 'jev',
        model: jev.model,
        verdict: 'pass',
        confidence: picked.confidence,
        reason: `Jev chose it at ${picked.confidence.toFixed(2)}.`,
        context: classification.state,
        detail: { jev: jev.answers },
        reviewed_at: at,
      },
    }
  }
  const { model, answer } = await deps.llm.answer(classification.prompt)
  const chosen = classification.parse(answer)
  if (!chosen) throw new ReviewerProtocolError('The LLM answered a classification outside its contract.')
  return {
    payload: chosen.payload,
    review: {
      reviewer: 'jev+llm',
      model,
      verdict: 'pass',
      confidence: chosen.confidence,
      reason: chosen.reason,
      context: classification.state,
      detail: { jev: jev.answers, llm: answer as Record<string, unknown> },
      reviewed_at: at,
    },
  }
}
