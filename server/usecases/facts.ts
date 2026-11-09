import type { Fact } from '@server/domain/fact'
import { contentKeyOf, factKinds, type SubjectType, targetOf } from '@server/domain/fact-kinds'
import { canApply, factTransitions } from '@server/domain/fact-lifecycle'
import { mayActOn, type Principal, principalRef } from '@server/domain/principal'
import type { EntryId, FactId, FactKind, FactStatus, SenseId, SubmitFactInput } from '@shared/facts'
import type { Deps } from './deps'
import { ConflictError, ForbiddenError, InvalidReferenceError, NotFoundError } from './errors'
import type { PageRequest } from './ports'

/** Who is acting, and the trace their work carries into async jobs. */
export interface Actor {
  principal: Principal
  traceId: string
}

type SubmitDeps = Pick<Deps, 'nodes' | 'facts' | 'reviewQueue' | 'clock' | 'ids'>

const subjectExists: { [S in SubjectType]: (deps: SubmitDeps, id: string) => Promise<boolean> } = {
  entry: async (deps, id) => (await deps.nodes.findEntry(id as EntryId)) !== null,
  sense: async (deps, id) => (await deps.nodes.findSense(id as SenseId)) !== null,
}

/**
 * Submits one fact for review. Idempotent by content key: resubmitting a live
 * fact returns it with created=false and enqueues nothing.
 */
export async function submitFact(
  deps: SubmitDeps,
  actor: Actor,
  input: SubmitFactInput,
): Promise<{ fact: Fact; created: boolean }> {
  const spec = factKinds[input.kind]
  if (!(await subjectExists[spec.subject](deps, input.subject_id))) {
    throw new InvalidReferenceError(`A ${input.kind} fact is about a ${spec.subject}; ${input.subject_id} is not one.`)
  }
  const target = targetOf(input.kind, input.payload)
  if (target && !(await deps.nodes.findSense(target))) {
    throw new InvalidReferenceError(`Target sense ${target} does not exist.`)
  }

  const subjectId = input.subject_id as EntryId | SenseId
  const contentKey = contentKeyOf(input.kind, input.payload)
  const existing = await deps.facts.findLive(input.kind, subjectId, contentKey)
  if (existing) return { fact: existing, created: false }

  const supersedesId = input.supersedes_id ?? null
  if (supersedesId) await assertSupersedable(deps, supersedesId, input.kind, subjectId)

  const now = deps.clock.now().toISOString()
  const draft = {
    id: deps.ids.fact(),
    kind: input.kind,
    subjectId,
    objectId: target,
    contentKey,
    payload: input.payload,
    status: 'pending',
    supersedesId,
    author: principalRef(actor.principal),
    review: null,
    createdAt: now,
    updatedAt: now,
  } as Fact
  const fact = await deps.facts.insert(draft)
  if (!fact) {
    throw new ConflictError(
      `This subject already has a live ${input.kind} fact; submit one correction that supersedes the published one.`,
    )
  }
  const created = fact.id === draft.id
  if (created) await deps.reviewQueue.enqueue([{ factId: fact.id, traceId: actor.traceId }])
  return { fact, created }
}

async function assertSupersedable(
  deps: SubmitDeps,
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
export async function retractFact(deps: Pick<Deps, 'facts' | 'clock'>, actor: Actor, id: FactId): Promise<Fact> {
  const fact = await getFact(deps, id)
  if (!mayActOn(actor.principal, fact.author)) throw new ForbiddenError('Agents may retract only their own facts.')
  if (fact.status === 'retracted') return fact
  if (!canApply('retract', fact.status)) throw new ConflictError(`A ${fact.status} fact cannot be retracted.`)
  const { from, to } = factTransitions.retract
  const applied = await deps.facts.transition({ id, from, to, at: deps.clock.now().toISOString() })
  if (!applied) throw new ConflictError('The fact changed while it was being retracted.')
  return getFact(deps, id)
}

/**
 * Sends a decided fact back through review. Pending facts are simply re-enqueued. The reset
 * conflicts when it would make a second live fact with the same content or in an exclusive slot.
 */
export async function rereviewFact(
  deps: Pick<Deps, 'facts' | 'reviewQueue' | 'clock'>,
  actor: Actor,
  id: FactId,
): Promise<Fact> {
  const fact = await getFact(deps, id)
  if (fact.status !== 'pending') {
    if (!canApply('rereview', fact.status)) throw new ConflictError(`A ${fact.status} fact cannot be re-reviewed.`)
    const { from, to } = factTransitions.rereview
    const applied = await deps.facts.transition({ id, from, to, at: deps.clock.now().toISOString() })
    if (!applied) throw new ConflictError('The fact changed while it was being reset.')
  }
  await deps.reviewQueue.enqueue([{ factId: id, traceId: actor.traceId }])
  return getFact(deps, id)
}
