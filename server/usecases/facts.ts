import type { Fact } from '@server/domain/fact'
import { contentKeyOf, factKinds, orientOf, type SubjectType, targetOf, topicOf } from '@server/domain/fact-kinds'
import { canApply, factTransitions, isLive } from '@server/domain/fact-lifecycle'
import { mayActOn, type Principal, principalRef } from '@server/domain/principal'
import { isLeaf } from '@server/domain/topics'
import type { EntryId, FactId, FactKind, FactStatus, Pos, SenseId, SubmitFactInput, TopicId } from '@shared/facts'
import type { Deps } from './deps'
import { ConflictError, ForbiddenError, InvalidReferenceError, NotFoundError } from './errors'
import type { PageRequest } from './ports'
import { refreshWork } from './work-scores'

/** Who is acting, and the trace their work carries into async jobs. */
export interface Actor {
  principal: Principal
  traceId: string
}

type SubmitDeps = Pick<Deps, 'nodes' | 'facts' | 'topics' | 'work' | 'reviewQueue' | 'clock' | 'ids'>

interface SubjectNode {
  entryId: EntryId
  /** The sense's part of speech; null for an entry. */
  pos: Pos | null
}

/** The subject node, or null when it does not exist. */
const subjectNode: { [S in SubjectType]: (deps: SubmitDeps, id: string) => Promise<SubjectNode | null> } = {
  entry: async (deps, id) => {
    const entry = await deps.nodes.findEntry(id as EntryId)
    return entry && { entryId: entry.id, pos: null }
  },
  sense: async (deps, id) => {
    const sense = await deps.nodes.findSense(id as SenseId)
    return sense && { entryId: sense.entryId, pos: sense.pos }
  },
}

async function assertLeafTopic(deps: Pick<Deps, 'topics'>, id: TopicId): Promise<void> {
  const topic = await deps.topics.find(id)
  if (!topic) throw new InvalidReferenceError(`Topic ${id} does not exist; GET /v1/topics lists the taxonomy.`)
  if (!isLeaf(topic)) {
    throw new InvalidReferenceError(`${id} is a topic category; tag the sense with one of its leaf topics.`)
  }
}

function slotTakenMessage(kind: FactKind): string {
  const { maxLive, subject } = factKinds[kind]
  if (maxLive !== undefined) {
    return `A ${subject} holds at most ${maxLive} live ${kind} facts; retract one before adding another.`
  }
  return `This subject already has a live ${kind} fact; submit one correction that supersedes the published one.`
}

/**
 * Submits one fact for review. Idempotent by content key: resubmitting a live
 * fact returns it with created=false and enqueues nothing. A symmetric relation
 * submitted from either end is the same fact.
 */
export async function submitFact(
  deps: SubmitDeps,
  actor: Actor,
  input: SubmitFactInput,
): Promise<{ fact: Fact; created: boolean }> {
  const { kind } = input
  const spec = factKinds[kind]
  const oriented = orientOf(kind, input.subject_id, input.payload)
  const subjectId = oriented.subjectId as EntryId | SenseId
  const payload = oriented.payload
  const subject = await subjectNode[spec.subject](deps, subjectId)
  if (!subject) {
    throw new InvalidReferenceError(`A ${kind} fact is about a ${spec.subject}; ${subjectId} is not one.`)
  }
  const { entryId, pos } = subject
  if (spec.subjectPos && !(pos && spec.subjectPos.includes(pos))) {
    throw new InvalidReferenceError(
      `A ${kind} fact is about a sense whose part of speech is ${spec.subjectPos.join(', ')}; this one is ${pos ?? 'an entry'}.`,
    )
  }
  const topic = topicOf(kind, payload)
  if (topic) await assertLeafTopic(deps, topic)
  const target = targetOf(kind, payload)
  if (target) {
    const targetSense = await deps.nodes.findSense(target)
    if (!targetSense) throw new InvalidReferenceError(`Target sense ${target} does not exist.`)
    if (targetSense.entryId === entryId) {
      throw new InvalidReferenceError(
        'A relation links senses of two different entries; both senses belong to one entry.',
      )
    }
  }

  const contentKey = contentKeyOf(kind, payload)
  const existing = await deps.facts.findLive(kind, subjectId, contentKey)
  if (existing) return { fact: existing, created: false }

  const supersedesId = input.supersedes_id ?? null
  if (supersedesId) await assertSupersedable(deps, supersedesId, kind, subjectId)

  const now = deps.clock.now().toISOString()
  const draft = {
    id: deps.ids.fact(),
    kind,
    subjectId,
    objectId: target,
    contentKey,
    payload,
    status: 'pending',
    supersedesId,
    author: principalRef(actor.principal),
    review: null,
    revalidateSince: null,
    createdAt: now,
    updatedAt: now,
  } as Fact
  const fact = await deps.facts.insert(draft)
  if (!fact) throw new ConflictError(slotTakenMessage(kind))
  const created = fact.id === draft.id
  await refreshWork(deps, [subjectId, target])
  if (created) await deps.reviewQueue.enqueue([{ factId: fact.id, traceId: actor.traceId }])
  return { fact, created }
}

async function assertSupersedable(
  deps: Pick<Deps, 'facts'>,
  supersedesId: FactId,
  kind: FactKind,
  subjectId: EntryId | SenseId,
): Promise<void> {
  const old = await deps.facts.find(supersedesId)
  if (!old) throw new InvalidReferenceError(`Superseded fact ${supersedesId} does not exist.`)
  if (old.kind !== kind || old.subjectId !== subjectId) {
    throw new InvalidReferenceError('A correction must have the same kind and subject as the fact it supersedes.')
  }
  if (old.status !== 'published')
    throw new ConflictError(`Only a published fact can be superseded; it is ${old.status}.`)
}

export async function getFact(deps: Pick<Deps, 'facts'>, id: FactId): Promise<Fact> {
  const fact = await deps.facts.find(id)
  if (!fact) throw new NotFoundError(`Fact ${id} not found.`)
  return fact
}

export function listFacts(
  deps: Pick<Deps, 'facts'>,
  filter: { status?: FactStatus; kind?: FactKind },
  page: PageRequest,
) {
  return deps.facts.list(filter, page)
}

/** Withdraws a pending or published fact. Agents retract only their own facts. */
export async function retractFact(
  deps: Pick<Deps, 'facts' | 'nodes' | 'work' | 'clock'>,
  actor: Actor,
  id: FactId,
): Promise<Fact> {
  const fact = await getFact(deps, id)
  if (!mayActOn(actor.principal, fact.author)) throw new ForbiddenError('Agents may retract only their own facts.')
  if (fact.status === 'retracted') return fact
  if (!canApply('retract', fact.status)) throw new ConflictError(`A ${fact.status} fact cannot be retracted.`)
  const { from, to } = factTransitions.retract
  const applied = await deps.facts.transition({ id, from, to, at: deps.clock.now().toISOString() })
  if (!applied) throw new ConflictError('The fact changed while it was being retracted.')
  await refreshWork(deps, [fact.subjectId, fact.objectId])
  return getFact(deps, id)
}

/**
 * Sends a decided fact back through review. Pending facts are simply re-enqueued. The reset
 * conflicts when it would make a second live fact with the same content or in an exclusive slot,
 * or when a rejected correction's original is no longer published to be superseded.
 */
export async function rereviewFact(
  deps: Pick<Deps, 'facts' | 'nodes' | 'work' | 'reviewQueue' | 'clock'>,
  actor: Actor,
  id: FactId,
): Promise<Fact> {
  const fact = await getFact(deps, id)
  if (fact.status !== 'pending') {
    if (!canApply('rereview', fact.status)) throw new ConflictError(`A ${fact.status} fact cannot be re-reviewed.`)
    // A published correction already took its original's place; a rejected one must still find it published.
    if (fact.status === 'rejected' && fact.supersedesId) {
      await assertSupersedable(deps, fact.supersedesId, fact.kind, fact.subjectId)
    }
    // A rejected fact that comes back to life takes a place among the live ones.
    const { maxLive } = factKinds[fact.kind]
    if (
      !isLive(fact.status) &&
      maxLive !== undefined &&
      (await deps.facts.listLive(fact.kind, fact.subjectId)).length >= maxLive
    ) {
      throw new ConflictError(slotTakenMessage(fact.kind))
    }
    const { from, to } = factTransitions.rereview
    const applied = await deps.facts.transition({ id, from, to, at: deps.clock.now().toISOString() })
    if (!applied) throw new ConflictError('The fact changed while it was being reset.')
    await refreshWork(deps, [fact.subjectId, fact.objectId])
  }
  await deps.reviewQueue.enqueue([{ factId: id, traceId: actor.traceId }])
  return getFact(deps, id)
}
