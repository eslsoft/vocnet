import { curatorReview, isCurated } from '@server/domain/curation'
import { currentGloss, type Fact, isKind } from '@server/domain/fact'
import {
  type AdmissionViews,
  admissionOf,
  contentKeyOf,
  endsAdmissionOf,
  factKinds,
  type Link,
  type LinkEnd,
  linkAdmissionOf,
  orientOf,
  referencesOf,
  type SenseEnd,
  type SubjectType,
  type SubjectTypeOf,
  subjectTypeOf,
  targetOf,
  topicOf,
} from '@server/domain/fact-kinds'
import { canApply, factTransitions, isLive } from '@server/domain/fact-lifecycle'
import { mayActOn, mayCurate, type Principal, principalRef } from '@server/domain/principal'
import { currentSenseList } from '@server/domain/sense-list'
import { type Lemma, normalizeTerm } from '@server/domain/term'
import { isLeaf } from '@server/domain/topics'
import type { EntryId, FactId, FactKind, FactPayloads, Pos, SenseId, SubmitFactInput, TopicId } from '@shared/facts'
import { requireCurator } from './access'
import type { Deps } from './deps'
import { ConflictError, CuratedFactError, ForbiddenError, InvalidReferenceError, NotFoundError } from './errors'
import type { FactFilter, PageRequest, WithEntry } from './ports'
import { refreshEntries } from './refresh'
import { recordDecision } from './review'

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

function slotTakenMessage(kind: FactKind, subject: SubjectType): string {
  const { maxLive } = factKinds[kind]
  if (maxLive !== undefined) {
    return `A ${subject} holds at most ${maxLive} live ${kind} facts; retract one before adding another.`
  }
  return `This subject already has a live ${kind} fact; submit one correction that supersedes the published one.`
}

/**
 * Submits one fact for review. Idempotent by content key: resubmitting a live
 * fact returns it with created=false and enqueues nothing. A symmetric relation
 * submitted from either end is the same fact. A curator's curated submission passes
 * every rule a submission does and then publishes at once with the curator's review,
 * enqueueing nothing; only a curator resubmits content a curator rejected.
 */
export async function submitFact(
  deps: SubmitDeps,
  actor: Actor,
  input: SubmitFactInput,
): Promise<{ fact: Fact; created: boolean }> {
  const { kind, curation } = input
  if (curation) requireCurator(actor.principal)
  const spec = factKinds[kind]
  const oriented = orientOf(kind, input.subject_id, input.payload)
  const subjectId = oriented.subjectId as EntryId | SenseId
  const payload = oriented.payload
  const subjectType = subjectTypeOf(kind, payload)
  const subject = await subjectNode[subjectType](deps, subjectId)
  if (!subject) {
    throw new InvalidReferenceError(`A ${kind} fact is about a ${subjectType}; ${subjectId} is not one.`)
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
  const targetSense = target && (await deps.nodes.findSense(target))
  if (target && !targetSense) throw new InvalidReferenceError(`Target sense ${target} does not exist.`)
  if (targetSense && targetSense.entryId === entryId) {
    throw new InvalidReferenceError(
      'A relation links senses of two different entries; both senses belong to one entry.',
    )
  }

  const contentKey = contentKeyOf(kind, payload)
  const existing = await deps.facts.findLive(kind, subjectId, contentKey)
  if (existing) return { fact: existing, created: false }
  if (!mayCurate(actor.principal) && (await deps.facts.findCuratedRejection(kind, subjectId, contentKey))) {
    throw new CuratedFactError('A curator rejected this fact; only a curator may submit it again.')
  }

  if (spec.admit) await assertAdmitted(kind, payload, subject)
  await assertReferencesLive(deps, referencesOf(kind, payload))
  const factId = deps.ids.fact()
  if (targetSense) {
    const link = {
      id: factId,
      payload,
      subject: { sense: subjectId as SenseId, entry: entryId },
      target: { sense: targetSense.id, entry: targetSense.entryId },
    }
    await assertEndsAdmitted(deps, kind, link)
    await assertLinkAdmitted(deps, kind, link)
  }
  const supersedesId = input.supersedes_id ?? null
  if (supersedesId) {
    const original = await assertSupersedable(deps, supersedesId, kind, subjectId)
    if (isCurated(original) && !mayCurate(actor.principal)) {
      throw new CuratedFactError('A curator settled the fact this corrects; only a curator may supersede it.')
    }
  }

  const now = deps.clock.now().toISOString()
  const draft = {
    id: factId,
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
    throw new ConflictError(slotTakenMessage(kind, subjectType))
  }
  const created = fact.id === draft.id
  if (created && curation) return { fact: await publishCurated(deps, actor, fact, curation.reason), created }
  await refreshEntries(deps, [subjectId, target])
  if (created) await deps.reviewQueue.enqueue([{ factId: fact.id, traceId: actor.traceId }])
  return { fact, created }
}

/** Publishes a curator's new pending fact with the curator's review, as a passing review would. */
async function publishCurated(deps: SubmitDeps, actor: Actor, fact: Fact, reason: string): Promise<Fact> {
  const at = deps.clock.now().toISOString()
  const review = curatorReview(actor.principal, 'pass', reason, at)
  const applied = await recordDecision(
    deps,
    fact,
    { event: 'curate_pass', from: ['pending'], at, review },
    actor.traceId,
  )
  if (!applied) throw new ConflictError('The fact changed while it was being published.')
  return getFact(deps, fact.id)
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

/** Each lemma the payload names is a live entry's; a read before the write, as `admit` is. */
async function assertReferencesLive(deps: SubjectDeps, lemmas: readonly string[]): Promise<void> {
  for (const lemma of lemmas) {
    const entry = await deps.nodes.findEntryByLemma(lemma as Lemma)
    const live = entry && (await deps.facts.listLive('entry', entry.id)).length > 0
    if (!live) {
      throw new InvalidReferenceError(
        `${JSON.stringify(lemma)} is not the lemma of a live entry; a base names an entry exactly as it is spelled. Create that entry first, or leave the lemma out.`,
      )
    }
  }
}

/**
 * What a link's end rule sees of a sense: whether its entry's current list puts it in extra, its
 * gloss's register, and its entry's lemma and live spelling variants.
 */
async function linkEnd(deps: SubjectDeps, { sense, entry }: SenseEnd): Promise<LinkEnd> {
  const [node, glosses, lists, forms] = await Promise.all([
    deps.nodes.findEntry(entry),
    deps.nodes.listLiveGlosses(entry),
    deps.facts.listLive('sense_list', entry),
    deps.facts.listLive('form', entry),
  ])
  if (!node) throw new Error(`Sense ${sense} belongs to entry ${entry}, which does not exist.`)
  const [first, ...rest] = glosses.filter((gloss) => gloss.sense.id === sense).map(({ fact }) => fact)
  const gloss = first && currentGloss([first, ...rest])
  return {
    sense,
    rare: currentSenseList(lists)?.payload.extra.includes(sense) ?? false,
    register: gloss?.payload.register ?? null,
    lemma: node.lemma,
    variants: forms
      .filter(isKind('form'))
      .filter((fact) => fact.payload.type === 'variant')
      .map((fact) => fact.payload.form),
  }
}

/** Runs the kind's end rule against the senses at both ends as they are now; a read before the write, as `admit` is. */
async function assertEndsAdmitted<K extends FactKind>(deps: SubjectDeps, kind: K, link: Link<K>): Promise<void> {
  const [subject, target] = await Promise.all([linkEnd(deps, link.subject), linkEnd(deps, link.target)])
  const refusal = endsAdmissionOf(kind, link.payload, { subject, target })
  if (refusal) throw new InvalidReferenceError(refusal)
}

/**
 * Runs the kind's link rule against the live links between the two entries as they are now; a
 * read before the write, as `admit` is, so two concurrent submissions can both pass it.
 */
async function assertLinkAdmitted<K extends FactKind>(
  deps: Pick<Deps, 'facts'>,
  kind: K,
  link: Link<K>,
): Promise<void> {
  const live = await deps.facts.listLiveLinks(kind, [link.subject.entry, link.target.entry])
  const refusal = linkAdmissionOf(
    kind,
    link,
    live.filter(({ id }) => id !== link.id),
  )
  if (refusal) throw new InvalidReferenceError(refusal)
}

/** A stored fact that links two senses, with the entries they belong to; nodes never outlive their facts. */
async function storedLink(deps: Pick<Deps, 'nodes'>, fact: Fact, targetId: SenseId): Promise<Link<FactKind>> {
  const [subject, target] = await Promise.all([
    deps.nodes.findSense(fact.subjectId as SenseId),
    deps.nodes.findSense(targetId),
  ])
  if (!subject || !target) throw new Error(`Fact ${fact.id} links a sense that does not exist.`)
  return {
    id: fact.id,
    payload: fact.payload,
    subject: { sense: subject.id, entry: subject.entryId },
    target: { sense: target.id, entry: target.entryId },
  }
}

/** The subject of a stored fact, which nodes never outlive. */
async function existingSubject(deps: SubjectDeps, fact: Fact): Promise<SubjectNode<SubjectType>> {
  const subject = await subjectNode[subjectTypeOf(fact.kind, fact.payload)](deps, fact.subjectId)
  if (!subject) throw new Error(`Fact ${fact.id} is about ${fact.subjectId}, which does not exist.`)
  return subject
}

/** The fact a correction supersedes, once it is a published fact of the correction's kind and subject. */
async function assertSupersedable(
  deps: Pick<Deps, 'facts'>,
  supersedesId: FactId,
  kind: FactKind,
  subjectId: EntryId | SenseId,
): Promise<Fact> {
  const old = await deps.facts.find(supersedesId)
  if (!old) throw new InvalidReferenceError(`Superseded fact ${supersedesId} does not exist.`)
  if (old.kind !== kind || old.subjectId !== subjectId) {
    throw new InvalidReferenceError('A correction must have the same kind and subject as the fact it supersedes.')
  }
  if (old.status !== 'published')
    throw new ConflictError(`Only a published fact can be superseded; it is ${old.status}.`)
  return old
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

/** One fact with the entry its subject is or belongs to; not found when no fact has the id. */
export async function getFactWithEntry(deps: Pick<Deps, 'facts'>, id: FactId): Promise<WithEntry<Fact>> {
  const fact = await deps.facts.findWithEntry(id)
  if (!fact) throw new NotFoundError(`Fact ${id} not found.`)
  return fact
}

/** Facts the filter admits, newest first; a lemma matches only the entry spelled exactly so. */
export function listFacts(deps: Pick<Deps, 'facts'>, filter: FactFilter, page: PageRequest) {
  return deps.facts.list(filter.lemma === undefined ? filter : { ...filter, lemma: normalizeTerm(filter.lemma) }, page)
}

/** Withdraws a pending or published fact. Agents retract only their own facts, and only curators curated ones. */
export async function retractFact(
  deps: Pick<Deps, 'facts' | 'nodes' | 'topics' | 'work' | 'reference' | 'publicViews' | 'clock'>,
  actor: Actor,
  id: FactId,
): Promise<Fact> {
  const fact = await getFact(deps, id)
  if (!mayActOn(actor.principal, fact.author)) throw new ForbiddenError('Agents may retract only their own facts.')
  if (isCurated(fact) && !mayCurate(actor.principal)) {
    throw new CuratedFactError('A curator settled this fact; only a curator may retract it.')
  }
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
  if (fact.status !== 'pending') await resetToPending(deps, fact)
  await deps.reviewQueue.enqueue([{ factId: id, traceId: actor.traceId }])
  return getFact(deps, id)
}

/**
 * Returns a published or rejected fact to `pending` through the `rereview` transition, enqueueing
 * nothing; the caller decides who reviews it. Returns the pending fact.
 */
export async function resetToPending(
  deps: Pick<Deps, 'facts' | 'nodes' | 'topics' | 'work' | 'reference' | 'publicViews' | 'clock'>,
  fact: Fact,
): Promise<Fact> {
  const { id } = fact
  if (!canApply('rereview', fact.status)) throw new ConflictError(`A ${fact.status} fact cannot be re-reviewed.`)
  // A rejected fact that comes back to life takes a place among the live ones; a correction
  // takes its original's place, so its original must still be published. A published fact is
  // live already and keeps its place.
  const reviving = !isLive(fact.status)
  if (reviving && factKinds[fact.kind].admit)
    await assertAdmitted(fact.kind, fact.payload, await existingSubject(deps, fact))
  if (reviving) await assertReferencesLive(deps, referencesOf(fact.kind, fact.payload))
  if (reviving && fact.objectId) {
    const link = await storedLink(deps, fact, fact.objectId)
    await assertEndsAdmitted(deps, fact.kind, link)
    await assertLinkAdmitted(deps, fact.kind, link)
  }
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
      if (liveBelow) throw new ConflictError(slotTakenMessage(fact.kind, subjectTypeOf(fact.kind, fact.payload)))
    }
    throw new ConflictError('The fact changed while it was being reset.')
  }
  await refreshEntries(deps, [fact.subjectId, fact.objectId])
  return getFact(deps, id)
}
