import type { Fact, FactOf } from '@server/domain/fact'
import {
  type DecisionModel,
  type DecisionRequest,
  type LookPlan,
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
import type { TopicView } from '@server/domain/topics'
import {
  blindGuessesSchema,
  type EntryId,
  type FactId,
  type FactKind,
  type FactStatus,
  type Review,
  type SenseId,
  type SentenceId,
  type TopicId,
} from '@shared/facts'
import type { MediaId } from '@shared/media'
import type { Deps } from './deps'
import { namedNodesOf } from './named'
import { ReviewerProtocolError } from './ports'
import { refreshEntries } from './refresh'

export type ReviewDeps = Pick<
  Deps,
  | 'nodes'
  | 'facts'
  | 'topics'
  | 'reference'
  | 'publicViews'
  | 'work'
  | 'decision'
  | 'llm'
  | 'media'
  | 'reviewQueue'
  | 'clock'
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

/** The subject of a fact as its review, or the classification of a slot on it, sees it. */
export function loadSubject<S extends keyof SubjectViews>(
  deps: ReviewDeps,
  type: S,
  id: string,
): Promise<SubjectViews[S]> {
  return (subjectLoaders[type] as (deps: ReviewDeps, id: string) => Promise<SubjectViews[S]>)(deps, id)
}

const subjectLoaders: { [S in keyof SubjectViews]: (deps: ReviewDeps, id: string) => Promise<SubjectViews[S]> } = {
  entry: async (deps, id) => {
    const entry = await deps.nodes.findEntry(id as EntryId)
    if (!entry) throw new Error(`Entry ${id} referenced by a fact does not exist.`)
    const [senses, caseVariants, reference] = await Promise.all([
      entrySenses(deps, entry.id),
      deps.nodes.listLiveCaseVariants(entry),
      deps.reference.forLemma(entry.lemma),
    ])
    return {
      lemma: entry.lemma,
      senses: senses.map(({ id: senseId, pos, gloss, rank, register, region }) => ({
        id: senseId,
        pos,
        gloss,
        rank,
        ...(register ? { register } : {}),
        ...(region ? { region } : {}),
      })),
      caseVariants,
      zipf: reference.frequency?.zipf ?? null,
    }
  },
  sense: (deps, id) => senseContext(deps, id as SenseId),
  fact: async (deps, id) => {
    const fact = await deps.facts.find(id as FactId)
    if (fact?.kind !== 'collocation') throw new Error(`Fact ${id} a translation translates is not a collocation.`)
    return { kind: fact.kind, text: fact.payload.text, sense: await senseContext(deps, fact.subjectId as SenseId) }
  },
  sentence: async (deps, id) => {
    const sentence = await deps.nodes.findSentence(id as SentenceId)
    if (!sentence) throw new Error(`Sentence ${id} referenced by a fact does not exist.`)
    const [uses, meanings] = await Promise.all([
      deps.nodes.listSentenceUses(sentence.id),
      deps.facts.listLive('sentence_meaning', sentence.id),
    ])
    const [example] = uses.examples
    const meaning = meanings.find((fact) => fact.status === 'published') ?? meanings[0]
    return {
      text: sentence.text,
      sense: example ? await senseContext(deps, example.senseId) : null,
      sayingOf: [...new Set(uses.sayings.map((saying) => saying.lemma as string))],
      meaning: meaning?.kind === 'sentence_meaning' ? meaning.payload.gloss : null,
    }
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
    named: await namedNodesOf(deps, fact as Fact),
  }
}

/** Asks every decision model of the request at once; their combined scores settle a pass or not. */
async function askDecision(
  deps: ReviewDeps,
  request: DecisionRequest,
): Promise<{ opinions: Opinion[]; settled: number | null }> {
  const answered = await Promise.all(
    request.gates.map(
      async (gate) => [gate, await deps.decision[gate.model].ask(request.questions, request.state)] as const,
    ),
  )
  const scores = new Map<DecisionModel, number>(answered.map(([gate, answers]) => [gate.model, scoreOf(answers)]))
  const opinions = answered.map(([gate, answers]) => decisionOpinion(gate.model, gate.passAt, answers))
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
  if (plan.kind === 'look') {
    const judgement = await look(deps, plan)
    const verdict = chainVerdict([judgement])
    return { context, finding: verdict.verdict, verdict }
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

/** The picture as the LLM sees it: a data URL of its bytes. */
async function pictureUrl(deps: Pick<Deps, 'media'>, id: MediaId): Promise<string> {
  const file = await deps.media.get(id)
  if (!file) throw new Error(`Picture ${id} of an image fact is not stored.`)
  const bytes = new Uint8Array(await new Response(file.body).arrayBuffer())
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return `data:${file.contentType};base64,${btoa(binary)}`
}

/** The LLM names what the picture shows without the word, then judges it with those guesses. */
async function look(deps: Pick<Deps, 'llm' | 'media'>, plan: LookPlan): Promise<Opinion> {
  const picture = await pictureUrl(deps, plan.image)
  const blind = await deps.llm.answer(plan.blind, [picture])
  const parsed = blindGuessesSchema.safeParse(blind.answer)
  if (!parsed.success)
    throw new ReviewerProtocolError('Blind guesses do not match their contract.', { cause: parsed.error })
  const prompt = plan.judge(parsed.data.guesses)
  const judgement = await deps.llm.judge(prompt, [picture])
  return { reviewer: 'llm', ...judgement, detail: { prompt, guesses: parsed.data.guesses } }
}

export type ReviewOutcome = 'published' | 'rejected' | 'skipped'

/**
 * Reviews one pending fact once and records the decision. Idempotent: any other fact is skipped,
 * and the status write is conditional on the status the review read, so a duplicate delivery
 * cannot change a decided fact. Reviewer transport errors propagate so the queue retries.
 */
/** The steps of one review, reported as each one ends so a review that never finishes shows where it stopped. */
export type ReviewStage = 'loaded' | 'judged' | 'transitioned' | 'admitted' | 'refreshed'
export type StageObserver = (stage: ReviewStage) => void

export async function reviewFact(
  deps: ReviewDeps,
  id: FactId,
  traceId: string,
  onStage: StageObserver = () => {},
): Promise<ReviewOutcome> {
  const fact = await deps.facts.find(id)
  onStage('loaded')
  if (fact?.status !== 'pending') return 'skipped'
  const { finding, verdict, context } = await judge(deps, fact)
  onStage('judged')
  const event = decide(finding)
  const at = deps.clock.now().toISOString()
  const applied = await recordDecision(
    deps,
    fact,
    { event, from: factTransitions[event].from, at, review: { ...verdict, context: { ...context }, reviewed_at: at } },
    traceId,
    onStage,
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

/** The entries a phrases list names as entry items; a saying admits nothing. */
const entryItems = (list: FactOf<'phrases'> | null): EntryId[] =>
  (list?.payload.phrases ?? []).flatMap((item) => (item.type === 'saying' ? [] : [item.entry_id]))

/**
 * Admits the entries a published phrases list names as entry items, in its headword's batch, and
 * lets the entries the list it replaces dropped go, unless another published list still names them.
 */
async function admitPhrases(deps: DecisionDeps, list: FactOf<'phrases'>): Promise<EntryId[]> {
  const head = await deps.nodes.admission(list.subjectId)
  const live = entryItems(list)
  const original = list.supersedesId ? ((await deps.facts.find(list.supersedesId)) as FactOf<'phrases'> | null) : null
  const dropped = entryItems(original).filter((id) => !live.includes(id))
  await deps.nodes.setPhrasesLive(live, dropped, head.batch ?? 0)
  return [...live, ...dropped]
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
  onStage: StageObserver = () => {},
): Promise<boolean> {
  const { to } = factTransitions[event]
  const publishes = fact.status !== 'published' && to === 'published'
  const supersede = publishes ? (fact.supersedesId ?? undefined) : undefined
  const applied = await deps.facts.transition({ id: fact.id, from, to, at, review, supersede })
  onStage('transitioned')
  if (!applied) return false
  // The phrases a published list admits or drops get or lose their items in this request.
  const phrases = publishes && fact.kind === 'phrases' ? await admitPhrases(deps, fact) : []
  onStage('admitted')
  await refreshEntries(deps, [fact.subjectId, fact.objectId, ...phrases])
  onStage('refreshed')
  return true
}

const PHRASE_LISTS_BATCH = 20

/**
 * Finishes the admission of published phrases lists that name a phrase with no live entry: the
 * publish wrote the list's status first, so an admission that failed after it is not retried by the
 * review queue. Admission is idempotent. Returns how many lists it finished.
 */
export async function reconcilePhraseLists(deps: DecisionDeps): Promise<number> {
  const ids = await deps.nodes.listUnadmittedPhraseLists(PHRASE_LISTS_BATCH)
  for (const id of ids) {
    const list = (await deps.facts.find(id)) as FactOf<'phrases'> | null
    if (!list) throw new Error(`Phrases list ${id} vanished while it was being admitted.`)
    const phrases = await admitPhrases(deps, list)
    await refreshEntries(deps, [list.subjectId, ...phrases])
  }
  return ids.length
}

// Longer than a queue backlog lasts: a fact still waiting in the queue is not stranded, and
// re-enqueueing it only crowds the batches with duplicates that review skips.
const RECONCILE_AFTER_MS = 60 * 60 * 1000
const RECONCILE_BATCH = 500

/** Re-enqueues facts pending for too long, so a lost enqueue cannot strand a fact. */
export async function reconcileReviews(
  deps: Pick<Deps, 'facts' | 'reviewQueue' | 'clock'>,
  traceId: string,
): Promise<number> {
  const now = deps.clock.now()
  const cutoff = new Date(now.getTime() - RECONCILE_AFTER_MS).toISOString()
  const ids = await deps.facts.claimStuckBefore(cutoff, RECONCILE_BATCH, now.toISOString())
  if (ids.length > 0) await deps.reviewQueue.enqueue(ids.map((factId) => ({ factId, traceId })))
  return ids.length
}
