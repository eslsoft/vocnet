import type { FactOf } from '@server/domain/fact'
import {
  factKinds,
  planReview,
  type ReviewContext,
  type ReviewRequest,
  type SenseView,
  type SubjectTypeOf,
  type SubjectViews,
  targetOf,
} from '@server/domain/fact-kinds'
import {
  decide,
  factTransitions,
  JEV_POLICY,
  jevVerdict,
  type ReviewFinding,
  reviewEffects,
  reviewModeOf,
} from '@server/domain/fact-lifecycle'
import type { EntryId, FactId, FactKind, ReviewerKind, SenseId, Verdict } from '@shared/facts'
import type { Deps } from './deps'

type ReviewDeps = Pick<Deps, 'nodes' | 'facts' | 'jev' | 'llm' | 'reviewQueue' | 'clock'>

interface Judgement {
  model: string
  verdict: Verdict
  confidence: number
  reason: string
  detail: Record<string, unknown>
}

const reviewers: {
  [R in ReviewerKind]: (
    deps: ReviewDeps,
    request: ReviewRequest<R>,
    state: Record<string, unknown>,
  ) => Promise<Judgement>
} = {
  jev: async (deps, { questions }, state) => {
    const { model, answers } = await deps.jev.ask(questions, state)
    const { verdict, confidence } = jevVerdict(answers)
    const scores = Object.entries(answers).map(([key, value]) => `${key}=${value}`)
    return { model, verdict, confidence, reason: `Jev ${scores.join(', ')}`, detail: { answers, policy: JEV_POLICY } }
  },
  llm: async (deps, { prompt }) => {
    const judgement = await deps.llm.judge(prompt)
    return { ...judgement, detail: { prompt } }
  },
}

function runReviewer<R extends ReviewerKind>(
  deps: ReviewDeps,
  request: ReviewRequest<R>,
  state: Record<string, unknown>,
): Promise<Judgement> {
  return reviewers[request.reviewer](deps, request, state)
}

async function senseView(deps: ReviewDeps, id: SenseId): Promise<SenseView> {
  const sense = await deps.nodes.findSense(id)
  if (!sense) throw new Error(`Sense ${id} referenced by a fact does not exist.`)
  const glosses = (await deps.facts.listLive('sense', id)) as FactOf<'sense'>[]
  // The current gloss is the published one; until one publishes, the pending one under review.
  const current = glosses.find((fact) => fact.status === 'published') ?? glosses[0]
  return { lemma: sense.lemma, pos: sense.pos, gloss: current?.payload.gloss ?? null }
}

const subjectLoaders: { [S in keyof SubjectViews]: (deps: ReviewDeps, id: string) => Promise<SubjectViews[S]> } = {
  entry: async (deps, id) => {
    const entry = await deps.nodes.findEntry(id as EntryId)
    if (!entry) throw new Error(`Entry ${id} referenced by a fact does not exist.`)
    return { lemma: entry.lemma }
  },
  sense: (deps, id) => senseView(deps, id as SenseId),
}

async function loadContext<K extends FactKind>(
  deps: ReviewDeps,
  fact: FactOf<K>,
): Promise<ReviewContext<SubjectTypeOf[K]>> {
  const subjectType: SubjectTypeOf[K] = factKinds[fact.kind].subject
  const subject = await subjectLoaders[subjectType](deps, fact.subjectId)
  const target = targetOf(fact.kind, fact.payload)
  return {
    subject: subject as SubjectViews[SubjectTypeOf[K]],
    target: target ? await senseView(deps, target) : null,
  }
}

async function judge<K extends FactKind>(
  deps: ReviewDeps,
  fact: FactOf<K>,
): Promise<{ reviewer: ReviewerKind; finding: ReviewFinding; judgement: Judgement; context: ReviewContext }> {
  const context = await loadContext(deps, fact)
  const plan = planReview(fact.kind, fact.payload, context)
  const reviewer = factKinds[fact.kind].reviewer
  if (plan.kind === 'unreviewable') {
    return {
      reviewer,
      context,
      finding: 'unreviewable',
      judgement: { model: 'none', verdict: 'fail', confidence: 1, reason: plan.reason, detail: {} },
    }
  }
  const state = { fact: { id: fact.id, kind: fact.kind, payload: fact.payload }, context }
  const judgement = await runReviewer(deps, plan.request, state)
  return { reviewer, context, finding: judgement.verdict, judgement }
}

export type ReviewOutcome = 'published' | 'rejected' | 'skipped'

/**
 * Reviews one pending fact, or revalidates one published fact whose gloss was corrected, and
 * records the decision. Idempotent: any other fact is skipped, and the status write is
 * conditional on the state the review read, so a duplicate delivery cannot change a decided
 * fact. When a correction publishes, the facts judged against the old version are marked and
 * enqueued for revalidation. Reviewer transport errors propagate so the queue retries.
 */
export async function reviewFact(deps: ReviewDeps, id: FactId, traceId: string): Promise<ReviewOutcome> {
  const fact = await deps.facts.find(id)
  const mode = fact && reviewModeOf(fact)
  if (!fact || !mode) return 'skipped'

  const { reviewer, finding, judgement, context } = await judge(deps, fact)
  const event = decide(mode, finding)
  const { outcome, records } = reviewEffects[event]
  const at = deps.clock.now().toISOString()
  const { from, to } = factTransitions[event]
  const supersede = event === 'publish' ? (fact.supersedesId ?? undefined) : undefined
  const dependents = supersede && factKinds[fact.kind].revalidates
  const applied = await deps.facts.transition({
    id,
    from,
    to,
    at,
    review: records
      ? {
          reviewer,
          model: judgement.model,
          verdict: judgement.verdict,
          confidence: judgement.confidence,
          reason: judgement.reason,
          context: { ...context },
          detail: judgement.detail,
          reviewed_at: at,
        }
      : undefined,
    supersede,
    revalidate: dependents ? { nodeId: fact.subjectId, kinds: dependents } : undefined,
    revalidateSince: fact.revalidateSince ?? undefined,
  })
  if (!applied) return 'skipped'
  if (dependents) {
    const ids = await deps.facts.listRevalidating(fact.subjectId)
    if (ids.length > 0) await deps.reviewQueue.enqueue(ids.map((factId) => ({ factId, traceId })))
  }
  return outcome
}

const RECONCILE_AFTER_MS = 5 * 60 * 1000
const RECONCILE_BATCH = 500

/**
 * Re-enqueues facts pending, or awaiting revalidation, for too long, so a lost enqueue cannot
 * strand a fact.
 */
export async function reconcileReviews(
  deps: Pick<Deps, 'facts' | 'reviewQueue' | 'clock'>,
  traceId: string,
): Promise<number> {
  const cutoff = new Date(deps.clock.now().getTime() - RECONCILE_AFTER_MS).toISOString()
  const ids = await deps.facts.listStuckBefore(cutoff, RECONCILE_BATCH)
  if (ids.length > 0) await deps.reviewQueue.enqueue(ids.map((factId) => ({ factId, traceId })))
  return ids.length
}
