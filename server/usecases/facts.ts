import { type Fact, isKind } from '@server/domain/fact'
import {
  type AdmissionViews,
  admissionOf,
  contentKeyOf,
  factKinds,
  orientOf,
  type SubjectType,
  type SubjectTypeOf,
  targetOf,
  topicOf,
} from '@server/domain/fact-kinds'
import { canApply, factTransitions, isLive } from '@server/domain/fact-lifecycle'
import { mayActOn, type Principal, principalRef } from '@server/domain/principal'
import { isLeaf } from '@server/domain/topics'
import type {
  EntryId,
  FactId,
  FactKind,
  FactPayloads,
  FactStatus,
  Pos,
  SenseId,
  SubmitFactInput,
  TopicId,
} from '@shared/facts'
import type { Deps } from './deps'
import { ConflictError, ForbiddenError, InvalidReferenceError, NotFoundError } from './errors'
import type { PageRequest } from './ports'
import { refreshEntries } from './refresh'

/** Who is acting, and the trace their work carries into async jobs. */
export interface Actor {
  principal: Principal
  traceId: string
}

type SubmitDeps = Pick<
  Deps,
  'nodes' | 'facts' | 'topics' | 'work' | 'reference' | 'publicViews' | 'reviewQueue' | 'clock' | 'ids'
>

interface SubjectNode<S extends SubjectType> {
  entryId: EntryId
  /** The sense's part of speech; null for an entry. */
  pos: Pos | null
  /** What the kind's write rule sees of the subject; loaded only for a kind that has one. */
  admission(): Promise<AdmissionViews[S]>
}

type SubjectDeps = Pick<Deps, 'nodes' | 'facts'>

const liveForms = async (deps: SubjectDeps, entryId: EntryId) =>
  (await deps.facts.listLive('form', entryId)).filter(isKind('form')).map((fact) => fact.payload.form)

/** The entry's senses whose gloss is live, each once. */
const liveSenses = async (deps: SubjectDeps, entryId: EntryId) => [
  ...new Set((await deps.nodes.listLiveGlosses(entryId)).map(({ sense }) => sense.id)),
]

/** The subject node, or null when it does not exist. */
const subjectNode: { [S in SubjectType]: (deps: SubjectDeps, id: string) => Promise<SubjectNode<S> | null> } = {
  entry: async (deps, id) => {
    const entry = await deps.nodes.findEntry(id as EntryId)
    return (
      entry && {
        entryId: entry.id,
        pos: null,
        admission: async () => ({ lemma: entry.lemma, senses: await liveSenses(deps, entry.id) }),
      }
    )
  },
  sense: async (deps, id) => {
    const sense = await deps.nodes.findSense(id as SenseId)
    return (
      sense && {
        entryId: sense.entryId,
        pos: sense.pos,
        admission: async () => ({ lemma: sense.lemma, pos: sense.pos, forms: await liveForms(deps, sense.entryId) }),
      }
    )
  },
}

async function assertLeafTopic(deps: Pick<Deps, 'topics'>, id: TopicId): Promise<void> {
  const topic = await deps.topics.find(id)
  if (!topic) throw new InvalidReferenceError(`Topic ${id} does not exist; GET /v1/topics lists the taxonomy.`)
  if (!isLeaf(topic)) {
    throw new InvalidReferenceError(`${id} is a topic category; tag the sense with one of its leaf topics.`)
  }
}

const UNDER_CORRECTION = 'A live correction supersedes this fact; review that correction instead.'
const ALREADY_CORRECTED =
  'The fact this corrects already has a live correction; retract that one or wait for its review.'

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

  if (spec.admit) await assertAdmitted(kind, payload, subject)
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
  if (!fact) {
    // The insert checked every rule in its own statement; this read only explains the refusal.
    if (supersedesId) await assertCorrectable(deps, supersedesId, kind, subjectId)
    throw new ConflictError(slotTakenMessage(kind))
  }
  const created = fact.id === draft.id
  await refreshEntries(deps, [subjectId, target])
  if (created) await deps.reviewQueue.enqueue([{ factId: fact.id, traceId: actor.traceId }])
  return { fact, created }
}

/** Runs the kind's write rule against the subject as it is now; only for a kind that has one. */
async function assertAdmitted<K extends FactKind>(
  kind: K,
  payload: FactPayloads[K],
  subject: SubjectNode<SubjectTypeOf[K]>,
): Promise<void> {
  const refusal = admissionOf(kind, payload, await subject.admission())
  if (refusal) throw new InvalidReferenceError(refusal)
}

/** The subject of a stored fact, which nodes never outlive. */
async function existingSubject(deps: SubjectDeps, fact: Fact): Promise<SubjectNode<SubjectType>> {
  const subject = await subjectNode[factKinds[fact.kind].subject](deps, fact.subjectId)
  if (!subject) throw new Error(`Fact ${fact.id} is about ${fact.subjectId}, which does not exist.`)
  return subject
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

/** Throws why a correction of this fact cannot go live now: the fact is not published, or already corrected. */
async function assertCorrectable(
  deps: Pick<Deps, 'facts'>,
  supersedesId: FactId,
  kind: FactKind,
  subjectId: EntryId | SenseId,
): Promise<void> {
  await assertSupersedable(deps, supersedesId, kind, subjectId)
  if (await deps.facts.findLiveCorrection(supersedesId)) throw new ConflictError(ALREADY_CORRECTED)
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
  deps: Pick<Deps, 'facts' | 'nodes' | 'topics' | 'work' | 'reference' | 'publicViews' | 'clock'>,
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
  await refreshEntries(deps, [fact.subjectId, fact.objectId])
  return getFact(deps, id)
}

/**
 * Sends a decided fact back through review. Pending facts are simply re-enqueued. The reset
 * conflicts when it would make a second live fact with the same content or in an exclusive slot,
 * when a live correction supersedes the fact, or when a rejected correction's original is no
 * longer published or already has another live correction. Each of those rules is a condition of
 * the reset write itself, which applies only to the status it read, so no concurrent write can slip
 * past one. Whether a revived payload still fits its subject (`admit`) is checked by a read before
 * the write, as a submission's is.
 */
export async function rereviewFact(
  deps: Pick<Deps, 'facts' | 'nodes' | 'topics' | 'work' | 'reference' | 'publicViews' | 'reviewQueue' | 'clock'>,
  actor: Actor,
  id: FactId,
): Promise<Fact> {
  const fact = await getFact(deps, id)
  if (fact.status !== 'pending') {
    if (!canApply('rereview', fact.status)) throw new ConflictError(`A ${fact.status} fact cannot be re-reviewed.`)
    // A rejected fact that comes back to life takes a place among the live ones; a correction
    // takes its original's place, so its original must still be published. A published fact is
    // live already and keeps its place.
    const reviving = !isLive(fact.status)
    if (reviving && factKinds[fact.kind].admit)
      await assertAdmitted(fact.kind, fact.payload, await existingSubject(deps, fact))
    const { maxLive } = factKinds[fact.kind]
    const liveBelow = reviving && maxLive !== undefined ? { max: maxLive, excluding: fact.supersedesId } : undefined
    const originalPublished = (reviving && fact.supersedesId) || undefined
    const { to } = factTransitions.rereview
    // While a correction of this fact is live, the correction is what review decides; reviving the
    // original beside it would let both publish.
    const applied = await deps.facts.transition({
      id,
      from: [fact.status],
      to,
      at: deps.clock.now().toISOString(),
      liveBelow,
      unsuperseded: true,
      originalPublished,
    })
    if (!applied) {
      const current = await getFact(deps, id)
      if (current.status === fact.status) {
        if (await deps.facts.findLiveCorrection(id)) throw new ConflictError(UNDER_CORRECTION)
        if (originalPublished) await assertCorrectable(deps, originalPublished, fact.kind, fact.subjectId)
        if (liveBelow) throw new ConflictError(slotTakenMessage(fact.kind))
      }
      throw new ConflictError('The fact changed while it was being reset.')
    }
    await refreshEntries(deps, [fact.subjectId, fact.objectId])
  }
  await deps.reviewQueue.enqueue([{ factId: id, traceId: actor.traceId }])
  return getFact(deps, id)
}
