import type { Fact, FactOf } from '@server/domain/fact'
import {
  type DecisionModel,
  type DecisionRequest,
  planReview,
  type ReviewContext,
  type SubjectTypeOf,
  type SubjectViews,
  subjectTypeOf,
  targetOf,
  topicOf,
} from '@server/domain/fact-kinds'
import { decide, type FactEvent, factTransitions, type ReviewFinding } from '@server/domain/fact-lifecycle'
import { currentInventory, inventorySenses } from '@server/domain/inventory'
import {
  type ChainVerdict,
  chainVerdict,
  decisionOpinion,
  decisionSettles,
  type Opinion,
  scoreOf,
} from '@server/domain/review-chain'
import type { Lemma } from '@server/domain/term'
import type { TopicView } from '@server/domain/topics'
import type { EntryId, FactId, FactKind, FactStatus, Review, SenseId, TopicId } from '@shared/facts'
import type { Deps } from './deps'
import { refreshEntries } from './refresh'

type ReviewDeps = Pick<
  Deps,
  'nodes' | 'facts' | 'topics' | 'reference' | 'publicViews' | 'work' | 'decision' | 'llm' | 'reviewQueue' | 'clock'
>

/** The senses of the entry's live inventory, in its order. */
async function entrySenses(deps: Pick<Deps, 'facts'>, entryId: EntryId) {
  return inventorySenses(currentInventory(await deps.facts.listLive('senses', entryId)))
}

/** A sense with its gloss in its entry's live inventory and the glosses of the entry's other senses. */
async function senseContext(deps: ReviewDeps, id: SenseId): Promise<SubjectViews['sense']> {
  const sense = await deps.nodes.findSense(id)
  if (!sense) throw new Error(`Sense ${id} referenced by a fact does not exist.`)
  const senses = await entrySenses(deps, sense.entryId)
  return {
    lemma: sense.lemma,
    pos: sense.pos,
    gloss: senses.find((candidate) => candidate.id === id)?.gloss ?? null,
    siblings: senses.filter((candidate) => candidate.id !== id).map(({ pos, gloss }) => ({ pos, gloss })),
  }
}

const subjectLoaders: { [S in keyof SubjectViews]: (deps: ReviewDeps, id: string) => Promise<SubjectViews[S]> } = {
  entry: async (deps, id) => {
    const entry = await deps.nodes.findEntry(id as EntryId)
    if (!entry) throw new Error(`Entry ${id} referenced by a fact does not exist.`)
    const [senses, caseVariants] = await Promise.all([entrySenses(deps, entry.id), deps.nodes.listLiveCaseVariants(entry)])
    return { lemma: entry.lemma, senses: senses.map(({ id: senseId, pos, gloss }) => ({ id: senseId, pos, gloss })), caseVariants }
  },
  sense: (deps, id) => senseContext(deps, id as SenseId),
  fact: async (deps, id) => {
    const fact = await deps.facts.find(id as FactId)
    if (!fact || (fact.kind !== 'example' && fact.kind !== 'collocation')) {
      throw new Error(`Fact ${id} a translation translates is not an example or a collocation.`)
    }
    return { kind: fact.kind, text: fact.payload.text, sense: await senseContext(deps, fact.subjectId as SenseId) }
  },
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
  const subjectType: SubjectTypeOf[K] = subjectTypeOf(fact.kind, fact.payload)
  const subject = await subjectLoaders[subjectType](deps, fact.subjectId)
  const target = targetOf(fact.kind, fact.payload)
  const topic = topicOf(fact.kind, fact.payload)
  return {
    subject: subject as SubjectViews[SubjectTypeOf[K]],
    target: target ? await senseContext(deps, target) : null,
    topic: topic ? await topicView(deps, topic) : null,
  }
}

/** Asks every decision model of the request at once; their combined scores settle a pass or not. */
async function askDecision(
  deps: ReviewDeps,
  request: DecisionRequest,
): Promise<{ opinions: Opinion[]; settled: number | null }> {
  const answered = await Promise.all(
    request.models.map(async (model) => [model, await deps.decision[model].ask(request.questions, request.state)] as const),
  )
  const scores = new Map<DecisionModel, number>(answered.map(([model, answers]) => [model, scoreOf(answers)]))
  const opinions = answered.map(([model, answers]) => decisionOpinion(model, request.passAt[model] ?? 1, answers))
  if (!decisionSettles(request, scores)) return { opinions, settled: null }
  return { opinions, settled: Math.max(...scores.values()) }
}

async function judge<K extends FactKind>(
  deps: ReviewDeps,
  fact: FactOf<K>,
): Promise<{ finding: ReviewFinding; verdict: ChainVerdict; context: ReviewContext }> {
  const context = await loadContext(deps, fact)
  const plan = planReview(fact.kind, fact.payload, context)
  if (plan.kind === 'unreviewable') {
    return {
      context,
      finding: 'unreviewable',
      verdict: { reviewer: 'llm', model: 'none', verdict: 'fail', confidence: 1, reason: plan.reason, detail: {} },
    }
  }
  const decided = plan.decision ? await askDecision(deps, plan.decision) : { opinions: [], settled: null }
  if (decided.settled !== null) {
    const verdict = chainVerdict(decided.opinions as [Opinion, ...Opinion[]], decided.settled)
    return { context, finding: 'pass', verdict }
  }
  const judgement = await deps.llm.judge(plan.prompt)
  const final: Opinion = { reviewer: 'llm', ...judgement, detail: { prompt: plan.prompt } }
  const verdict = chainVerdict([...decided.opinions, final] as unknown as [Opinion, ...Opinion[]])
  return { context, finding: verdict.verdict, verdict }
}

export type ReviewOutcome = 'published' | 'rejected' | 'skipped'

/**
 * Reviews one pending fact once and records the decision. Idempotent: any other fact is skipped,
 * and the status write is conditional on the status the review read, so a duplicate delivery
 * cannot change a decided fact. Reviewer transport errors propagate so the queue retries.
 */
export async function reviewFact(deps: ReviewDeps, id: FactId, traceId: string): Promise<ReviewOutcome> {
  const fact = await deps.facts.find(id)
  if (!fact || fact.status !== 'pending') return 'skipped'
  const { finding, verdict, context } = await judge(deps, fact)
  const event = decide(finding)
  const at = deps.clock.now().toISOString()
  const applied = await recordDecision(
    deps,
    fact,
    { event, from: factTransitions[event].from, at, review: { ...verdict, context: { ...context }, reviewed_at: at } },
    traceId,
  )
  if (!applied) return 'skipped'
  return event === 'publish' ? 'published' : 'rejected'
}

export type DecisionDeps = Pick<
  Deps,
  'nodes' | 'facts' | 'topics' | 'reference' | 'publicViews' | 'work' | 'reviewQueue' | 'clock'
>

export interface Decision {
  event: FactEvent
  /** The statuses the write applies to; within the event's `from`. */
  from: readonly FactStatus[]
  at: string
  review?: Review
}

/**
 * Admits the phrases a published phrases list names, in its headword's batch, and lets the phrases
 * the list it replaces dropped go, unless another published list still names them.
 */
async function admitPhrases(deps: DecisionDeps, list: FactOf<'phrases'>, at: string): Promise<void> {
  const head = await deps.nodes.admission(list.subjectId)
  const admitted = await deps.nodes.admit(list.payload.phrases as Lemma[], head.batch ?? 0, list.author, at)
  const original = list.supersedesId ? ((await deps.facts.find(list.supersedesId)) as FactOf<'phrases'> | null) : null
  const kept = new Set(list.payload.phrases)
  const dropped = (original?.payload.phrases ?? []).filter((phrase) => !kept.has(phrase))
  const droppedEntries = (await Promise.all(dropped.map((lemma) => deps.nodes.findEntryByLemma(lemma as Lemma)))).flatMap(
    (entry) => (entry ? [entry.id] : []),
  )
  await deps.nodes.setPhrasesLive(
    admitted.map((entry) => entry.id),
    droppedEntries,
    head.batch,
  )
}

/**
 * Writes a decision on a fact, a reviewer's or a curator's. A pending fact that publishes retires
 * the original it corrects in the same batch. A published phrases list admits its phrases as
 * entries. False when the fact left `from` first.
 */
export async function recordDecision(
  deps: DecisionDeps,
  fact: Fact,
  { event, from, at, review }: Decision,
  _traceId: string,
): Promise<boolean> {
  const { to } = factTransitions[event]
  const publishes = fact.status !== 'published' && to === 'published'
  const supersede = publishes ? (fact.supersedesId ?? undefined) : undefined
  const applied = await deps.facts.transition({ id: fact.id, from, to, at, review, supersede })
  if (!applied) return false
  if (publishes && fact.kind === 'phrases') await admitPhrases(deps, fact, at)
  await refreshEntries(deps, [fact.subjectId, fact.objectId])
  return true
}

const RECONCILE_AFTER_MS = 5 * 60 * 1000
const RECONCILE_BATCH = 500

/** Re-enqueues facts pending for too long, so a lost enqueue cannot strand a fact. */
export async function reconcileReviews(
  deps: Pick<Deps, 'facts' | 'reviewQueue' | 'clock'>,
  traceId: string,
): Promise<number> {
  const cutoff = new Date(deps.clock.now().getTime() - RECONCILE_AFTER_MS).toISOString()
  const ids = await deps.facts.listStuckBefore(cutoff, RECONCILE_BATCH)
  if (ids.length > 0) await deps.reviewQueue.enqueue(ids.map((factId) => ({ factId, traceId })))
  return ids.length
}
