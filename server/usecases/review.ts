import { currentGloss, type FactOf } from '@server/domain/fact'
import {
  factKinds,
  type InflectionOf,
  inflectionKeysOf,
  planReview,
  type Rereview,
  type ReviewContext,
  type ReviewRequest,
  rereviewOf,
  revalidatedBy,
  type SenseGloss,
  type SenseView,
  type SubjectTypeOf,
  type SubjectViews,
  targetOf,
  topicOf,
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
import type { EntryNode, SenseNode } from '@server/domain/nodes'
import { type ChainVerdict, chainVerdict, type Opinion, settles } from '@server/domain/review-chain'
import type { TopicView } from '@server/domain/topics'
import type { EntryId, FactId, FactKind, ReviewerKind, SenseId, TopicId } from '@shared/facts'
import type { Deps } from './deps'
import { refreshEntries } from './refresh'

type ReviewDeps = Pick<
  Deps,
  'nodes' | 'facts' | 'topics' | 'reference' | 'publicViews' | 'work' | 'jev' | 'llm' | 'reviewQueue' | 'clock'
>

const reviewers: {
  [R in ReviewerKind]: (deps: ReviewDeps, request: ReviewRequest<R>, state: Record<string, unknown>) => Promise<Opinion>
} = {
  jev: async (deps, { questions }, state) => {
    const { model, answers } = await deps.jev.ask(questions, state)
    const { verdict, confidence } = jevVerdict(answers)
    const scores = Object.entries(answers).map(([key, value]) => `${key}=${value}`)
    return {
      reviewer: 'jev',
      model,
      verdict,
      confidence,
      reason: `Jev ${scores.join(', ')}`,
      detail: { answers, policy: JEV_POLICY },
    }
  },
  llm: async (deps, { prompt }) => {
    const judgement = await deps.llm.judge(prompt)
    return { reviewer: 'llm', ...judgement, detail: { prompt } }
  },
}

function runReviewer<R extends ReviewerKind>(
  deps: ReviewDeps,
  request: ReviewRequest<R>,
  state: Record<string, unknown>,
): Promise<Opinion> {
  return reviewers[request.reviewer](deps, request, state)
}

/** Asks each reviewer of the chain in turn until one settles the fact. */
async function runChain(
  deps: ReviewDeps,
  requests: readonly ReviewRequest[],
  state: Record<string, unknown>,
): Promise<ChainVerdict> {
  const opinions: Opinion[] = []
  for (const request of requests) {
    const opinion = await runReviewer(deps, request, state)
    opinions.push(opinion)
    if (settles(request, opinion)) break
  }
  return chainVerdict(opinions as [Opinion, ...Opinion[]])
}

/** A sense with its current gloss and the current glosses of its entry's other senses. */
async function senseContext(deps: ReviewDeps, id: SenseId): Promise<SubjectViews['sense']> {
  const sense = await deps.nodes.findSense(id)
  if (!sense) throw new Error(`Sense ${id} referenced by a fact does not exist.`)
  const senses = await entryGlosses(deps, sense.entryId)
  return {
    lemma: sense.lemma,
    pos: sense.pos,
    gloss: senses.find(({ senseId }) => senseId === id)?.gloss ?? null,
    siblings: senses.filter(({ senseId }) => senseId !== id).map(({ pos, gloss }) => ({ pos, gloss })),
  }
}

/** The current gloss of each glossed sense of an entry, in sense order. */
async function entryGlosses(deps: ReviewDeps, entryId: EntryId): Promise<Array<SenseGloss & { senseId: SenseId }>> {
  const bySense = new Map<SenseId, { sense: SenseNode; glosses: [FactOf<'sense'>, ...FactOf<'sense'>[]] }>()
  for (const { sense, fact } of await deps.nodes.listLiveGlosses(entryId)) {
    const group = bySense.get(sense.id)
    bySense.set(sense.id, { sense, glosses: group ? [...group.glosses, fact] : [fact] })
  }
  return [...bySense.values()].map(({ sense, glosses }) => ({
    senseId: sense.id,
    pos: sense.pos,
    gloss: currentGloss(glosses).payload.gloss,
  }))
}

/** The other live entries whose live inflections spell this entry's lemma. */
async function inflectionOf(deps: ReviewDeps, entry: EntryNode): Promise<InflectionOf[]> {
  const forms = await deps.nodes.findLiveForms(inflectionKeysOf(entry.lemma))
  return forms
    .filter((form) => form.entry.id !== entry.id)
    .map((form) => ({ lemma: form.entry.lemma, type: form.fact.payload.type }))
}

const subjectLoaders: { [S in keyof SubjectViews]: (deps: ReviewDeps, id: string) => Promise<SubjectViews[S]> } = {
  entry: async (deps, id) => {
    const entry = await deps.nodes.findEntry(id as EntryId)
    if (!entry) throw new Error(`Entry ${id} referenced by a fact does not exist.`)
    const [senses, inflections, cefr, caseVariants] = await Promise.all([
      entryGlosses(deps, entry.id),
      inflectionOf(deps, entry),
      deps.reference.listCefrListings(entry.lemma),
      deps.nodes.listLiveCaseVariants(entry),
    ])
    return {
      lemma: entry.lemma,
      senses: senses.map(({ senseId, pos, gloss }) => ({ id: senseId, pos, gloss })),
      inflectionOf: inflections,
      cefr,
      caseVariants,
    }
  },
  sense: (deps, id) => senseContext(deps, id as SenseId),
}

async function targetView(deps: ReviewDeps, id: SenseId): Promise<SenseView> {
  const { lemma, pos, gloss } = await senseContext(deps, id)
  return { lemma, pos, gloss }
}

/** A leaf topic with its category's name; null when the id names no leaf topic. */
async function topicView(deps: ReviewDeps, id: TopicId): Promise<TopicView | null> {
  const topic = await deps.topics.find(id)
  if (!topic?.parentId) return null
  const category = await deps.topics.find(topic.parentId)
  if (!category) throw new Error(`Topic ${id} belongs to category ${topic.parentId}, which does not exist.`)
  return { category: category.nameEn, topic: topic.nameEn }
}

async function loadContext<K extends FactKind>(
  deps: ReviewDeps,
  fact: FactOf<K>,
): Promise<ReviewContext<SubjectTypeOf[K]>> {
  const subjectType: SubjectTypeOf[K] = factKinds[fact.kind].subject
  const subject = await subjectLoaders[subjectType](deps, fact.subjectId)
  const target = targetOf(fact.kind, fact.payload)
  const topic = topicOf(fact.kind, fact.payload)
  return {
    subject: subject as SubjectViews[SubjectTypeOf[K]],
    target: target ? await targetView(deps, target) : null,
    topic: topic ? await topicView(deps, topic) : null,
  }
}

async function judge<K extends FactKind>(
  deps: ReviewDeps,
  fact: FactOf<K>,
): Promise<{ finding: ReviewFinding; verdict: ChainVerdict; context: ReviewContext }> {
  const context = await loadContext(deps, fact)
  const plan = planReview(fact.kind, fact.payload, context)
  if (plan.kind === 'unreviewable') {
    const [reviewer] = factKinds[fact.kind].chain
    return {
      context,
      finding: 'unreviewable',
      verdict: { reviewer, model: 'none', verdict: 'fail', confidence: 1, reason: plan.reason, detail: {} },
    }
  }
  const state = { fact: { id: fact.id, kind: fact.kind, payload: fact.payload }, context }
  const verdict = await runChain(deps, plan.requests, state)
  return { context, finding: verdict.verdict, verdict }
}

async function revalidatedByCorrection<K extends FactKind>(
  deps: ReviewDeps,
  correction: FactOf<K>,
  originalId: FactId,
): Promise<readonly FactKind[] | undefined> {
  if (!factKinds[correction.kind].revalidates) return undefined
  const original = (await deps.facts.find(originalId)) as FactOf<K> | null
  if (!original) throw new Error(`Fact ${originalId} superseded by ${correction.id} does not exist.`)
  return revalidatedBy(correction.kind, original.payload, correction.payload)
}

/** Enqueues the facts a publish marked for a review in place: the live marked facts of the other entry. */
async function enqueueRereviews(deps: ReviewDeps, { lemma }: Rereview, traceId: string): Promise<void> {
  const entry = await deps.nodes.findEntryByLemma(lemma)
  if (!entry) return
  const ids = await deps.facts.listRevalidating(entry.id)
  if (ids.length > 0) await deps.reviewQueue.enqueue(ids.map((factId) => ({ factId, traceId })))
}

export type ReviewOutcome = 'published' | 'rejected' | 'skipped'

/**
 * Reviews one pending fact, or revalidates one published fact whose gloss was corrected, and
 * records the decision. Idempotent: any other fact is skipped, and the status write is
 * conditional on the status and revalidation mark the review read, so a duplicate delivery
 * cannot change a decided fact and a review that read a superseded gloss cannot land. When a
 * correction publishes, the live facts judged or about to be judged against the old version are
 * marked and enqueued, and when a fact publishes that another entry's review lacked as evidence
 * (an inflection spelled like that entry's lemma), the facts it names are marked and enqueued too.
 * Reviewer transport errors propagate so the queue retries.
 */
export async function reviewFact(deps: ReviewDeps, id: FactId, traceId: string): Promise<ReviewOutcome> {
  const fact = await deps.facts.find(id)
  const mode = fact && reviewModeOf(fact)
  if (!fact || !mode) return 'skipped'

  const { finding, verdict, context } = await judge(deps, fact)
  const event = decide(mode, finding)
  const { outcome, records } = reviewEffects[event]
  const at = deps.clock.now().toISOString()
  const { from, to } = factTransitions[event]
  const supersede = event === 'publish' ? (fact.supersedesId ?? undefined) : undefined
  const dependents = supersede && (await revalidatedByCorrection(deps, fact, supersede))
  const rereview = event === 'publish' ? rereviewOf(fact.kind, fact.payload) : null
  const applied = await deps.facts.transition({
    id,
    from,
    to,
    at,
    review: records ? { ...verdict, context: { ...context }, reviewed_at: at } : undefined,
    supersede,
    revalidate: dependents ? { nodeId: fact.subjectId, kinds: dependents } : undefined,
    revalidateSince: fact.revalidateSince,
    rereview: rereview ?? undefined,
  })
  if (!applied) return 'skipped'
  await refreshEntries(deps, [fact.subjectId, fact.objectId])
  if (dependents) {
    const ids = await deps.facts.listRevalidating(fact.subjectId)
    if (ids.length > 0) await deps.reviewQueue.enqueue(ids.map((factId) => ({ factId, traceId })))
  }
  if (rereview) await enqueueRereviews(deps, rereview, traceId)
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
