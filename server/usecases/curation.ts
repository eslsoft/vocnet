import { curationEvents, curatorReview } from '@server/domain/curation'
import type { Fact } from '@server/domain/fact'
import { canApply } from '@server/domain/fact-lifecycle'
import type { CurateFactInput, FactId } from '@shared/facts'
import { requireCurator } from './access'
import { ConflictError } from './errors'
import { type Actor, getFact, resetToPending } from './facts'
import { type DecisionDeps, recordDecision } from './review'

/**
 * Settles a fact with a curator's verdict instead of the reviewer chain's. Pass publishes a
 * pending, published, or rejected fact and records the curator's review; fail rejects a pending or
 * published one. A rejected fact is first revived through the re-review reset, so passing it
 * conflicts exactly when re-reviewing it would: another live fact holds its content or slot, a live
 * correction supersedes it, or its original is gone. Publishing a pending correction retires its
 * original, as a passing review does.
 */
export async function curateFact(
  deps: DecisionDeps,
  actor: Actor,
  id: FactId,
  { verdict, reason }: CurateFactInput,
): Promise<Fact> {
  requireCurator(actor.principal)
  const found = await getFact(deps, id)
  const fact = verdict === 'pass' && found.status === 'rejected' ? await resetToPending(deps, found) : found
  const event = curationEvents[verdict]
  if (!canApply(event, fact.status)) throw new ConflictError(`A ${fact.status} fact cannot be curated to ${verdict}.`)
  const at = deps.clock.now().toISOString()
  const review = curatorReview(actor.principal, verdict, reason, at)
  const applied = await recordDecision(deps, fact, { event, from: [fact.status], at, review }, actor.traceId)
  if (!applied) throw new ConflictError('The fact changed while it was being curated.')
  return getFact(deps, id)
}
