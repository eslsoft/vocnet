import { curatorReview, isCurated } from '@server/domain/curation'
import { type Fact, isKind } from '@server/domain/fact'
import {
  type AdmissionViews,
  admissionOf,
  bindNames,
  contentKeyOf,
  endsAdmissionOf,
  factKinds,
  type Link,
  type LinkEnd,
  linkAdmissionOf,
  mediaOf,
  mentionsOf,
  type NamedNodes,
  namedTextsOf,
  objectOf,
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
import { currentInventory, inventorySenses } from '@server/domain/inventory'
import { mayActOn, mayCurate, type Principal, principalRef } from '@server/domain/principal'
import { type Lemma, normalizeTerm, textKey } from '@server/domain/term'
import { isLeaf } from '@server/domain/topics'
import type {
  EntryId,
  FactId,
  FactKind,
  FactPayloads,
  Pos,
  Review,
  SenseId,
  SentenceId,
  SubmitFactInput,
  SubmitPayloads,
  TopicId,
} from '@shared/facts'
import { requireCurator } from './access'
import type { Deps } from './deps'
import {
  ConflictError,
  CuratedFactError,
  ForbiddenError,
  InvalidReferenceError,
  InventorySettledError,
  NotFoundError,
  RejectedBeforeError,
} from './errors'
import { namedNodesOf } from './named'
import type { FactFilter, PageRequest, WithEntry } from './ports'
import { refreshEntries } from './refresh'
import { recordDecision } from './review'

/** Who is acting, and the trace their work carries into async jobs. */
export interface Actor {
  principal: Principal
  traceId: string
}

export type SubmitDeps = Pick<
  Deps,
  'nodes' | 'facts' | 'topics' | 'work' | 'reference' | 'publicViews' | 'media' | 'reviewQueue' | 'clock' | 'ids'
>

interface SubjectNode<S extends SubjectType> {
  /** The entry the subject is or belongs to; null for a sentence, which entries share. */
  entryId: EntryId | null
  /** The sense's part of speech; null for an entry. */
  pos: Pos | null
  /** What the kind's write rule sees of the subject; loaded only for a kind that has one. */
  admission(): Promise<AdmissionViews[S]>
}

type SubjectDeps = Pick<Deps, 'nodes' | 'facts'>

const liveForms = async (deps: SubjectDeps, entryId: EntryId) =>
  (await deps.facts.listLive('form', entryId)).filter(isKind('form')).map((fact) => fact.payload.form)

/** The senses of the entry's live inventory. */
const inventoryOf = async (deps: SubjectDeps, entryId: EntryId) =>
  inventorySenses(currentInventory(await deps.facts.listLive('senses', entryId)))

/** The senses of the entry's published inventory: only these can be referenced once it publishes. */
const publishedSenses = async (deps: SubjectDeps, entryId: EntryId) =>
  inventorySenses(currentInventory(await deps.facts.listLive('senses', entryId), (status) => status === 'published'))

/** The subject node, or null when it does not exist. */
const subjectNode: { [S in SubjectType]: (deps: SubjectDeps, id: string) => Promise<SubjectNode<S> | null> } = {
  entry: async (deps, id) => {
    const entry = await deps.nodes.findEntry(id as EntryId)
    return (
      entry && {
        entryId: entry.id,
        pos: null,
        admission: async () => {
          const [rows, inventory] = await Promise.all([deps.nodes.listSenses(entry.id), inventoryOf(deps, entry.id)])
          return {
            lemma: entry.lemma,
            // Every sense row of the entry, so a new inventory can keep a sense a rejected one named.
            senses: rows.map(({ id: sense }) => sense),
            inventory: inventory.map(({ id: sense }) => sense),
            commonPos: [...new Set(inventory.filter(({ rank }) => rank === 'common').map(({ pos }) => pos))],
          }
        },
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
  fact: async (deps, id) => {
    const fact = await deps.facts.find(id as FactId)
    if (fact?.kind !== 'collocation') return null
    const sense = await deps.nodes.findSense(fact.subjectId as SenseId)
    if (!sense) throw new Error(`The ${fact.kind} ${fact.id} is about sense ${fact.subjectId}, which does not exist.`)
    return { entryId: sense.entryId, pos: sense.pos, admission: async () => ({ kind: fact.kind }) }
  },
  sentence: async (deps, id) => {
    const sentence = await deps.nodes.findSentence(id as SentenceId)
    return sentence && { entryId: null, pos: null, admission: async () => ({ text: sentence.text }) }
  },
}

/** A submission with every node it named by text bound to an id, and the nodes it names. */
interface Resolved<K extends FactKind> {
  payload: FactPayloads[K]
  named: NamedNodes
  /** Lemmas and sentence texts the submission named that no node has yet: they are created once it is admitted. */
  missing: { lemmas: string[]; sentences: string[] }
}

/**
 * Binds the nodes a submission names by text: an entry by its exact lemma, a sentence by its text
 * key. A node that does not exist yet gets a provisional id; `createNamed` creates it. Every node
 * the payload names by id must exist (422).
 */
async function resolveNames<K extends FactKind>(
  deps: Pick<Deps, 'nodes' | 'ids'>,
  kind: K,
  submitted: SubmitPayloads[K],
  known?: { entries: ReadonlyMap<string, EntryId>; sentences: ReadonlyMap<string, SentenceId> },
): Promise<Resolved<K>> {
  const texts = namedTextsOf(kind, submitted)
  const lemmas = [...new Set(texts.lemmas.map(normalizeTerm))]
  const [entries, sentences] = await Promise.all([
    known ? [] : deps.nodes.findEntriesByLemmas(lemmas),
    known ? [] : deps.nodes.findSentencesByTexts(texts.sentences),
  ])
  const entryIds = new Map<string, EntryId>(known?.entries ?? entries.map((entry) => [entry.lemma, entry.id]))
  const sentenceIds = new Map<string, SentenceId>(
    known?.sentences ?? sentences.map((sentence) => [textKey(sentence.text), sentence.id]),
  )
  const missing = {
    lemmas: lemmas.filter((lemma) => !entryIds.has(lemma)),
    sentences: [...new Set(texts.sentences.map((text) => normalizeTerm(text)))].filter(
      (text) => !sentenceIds.has(textKey(text)),
    ),
  }
  for (const lemma of missing.lemmas) entryIds.set(lemma, deps.ids.entry())
  for (const text of missing.sentences) sentenceIds.set(textKey(text), deps.ids.sentence())
  const lemmaOf = new Map([...entryIds].map(([lemma, id]) => [id as string, lemma]))
  const textOf = new Map<string, string>([
    ...sentences.map((sentence) => [sentence.id as string, sentence.text] as const),
    ...missing.sentences.map((text) => [sentenceIds.get(textKey(text)) as string, text] as const),
  ])
  const payload = bindNames(kind, submitted, {
    entry: (lemma) => entryIds.get(normalizeTerm(lemma)) as EntryId,
    sentence: (text) => sentenceIds.get(textKey(text)) as SentenceId,
  })
  const mentions = mentionsOf(kind, payload)
  const [namedEntries, namedSentences] = await Promise.all([
    deps.nodes.findEntries(mentions.entries.filter((id) => !lemmaOf.has(id))),
    deps.nodes.findSentences(mentions.sentences.filter((id) => !textOf.has(id))),
  ])
  for (const entry of namedEntries) lemmaOf.set(entry.id, entry.lemma)
  for (const sentence of namedSentences) textOf.set(sentence.id, sentence.text)
  const unknown = [
    ...mentions.entries.filter((id) => !lemmaOf.has(id)).map((id) => `entry ${id}`),
    ...mentions.sentences.filter((id) => !textOf.has(id)).map((id) => `sentence ${id}`),
  ]
  if (unknown.length > 0) {
    throw new InvalidReferenceError(`A ${kind} fact names ${unknown.join(', ')}, which does not exist.`)
  }
  return { payload, named: { entries: lemmaOf, sentences: textOf }, missing }
}

/**
 * Creates the nodes a submission named by text that did not exist: entries not live, sentences
 * with no source. A concurrent submission may have created one first, so the submission is bound
 * again to the stored ids.
 */
async function createNamed<K extends FactKind>(
  deps: Pick<Deps, 'nodes' | 'ids'>,
  actor: Actor,
  kind: K,
  submitted: SubmitPayloads[K],
  resolved: Resolved<K>,
  at: string,
): Promise<Resolved<K>> {
  const { lemmas, sentences } = resolved.missing
  if (lemmas.length === 0 && sentences.length === 0) return resolved
  const createdBy = principalRef(actor.principal)
  const [entries, stored] = await Promise.all([
    deps.nodes.ensureEntries(lemmas as Lemma[], createdBy, at),
    deps.nodes.insertSentences(
      sentences.map((text) => ({ id: deps.ids.sentence(), text, source: null, createdBy, createdAt: at })),
    ),
  ])
  const known = {
    entries: new Map<string, EntryId>([
      ...[...resolved.named.entries].map(([id, lemma]) => [lemma, id as EntryId] as const),
      ...entries.map((entry) => [entry.lemma as string, entry.id] as const),
    ]),
    sentences: new Map<string, SentenceId>([
      ...[...resolved.named.sentences].map(([id, text]) => [textKey(text), id as SentenceId] as const),
      ...stored.map((sentence) => [textKey(sentence.text), sentence.id] as const),
    ]),
  }
  return resolveNames(deps, kind, submitted, known)
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
 * enqueueing nothing; only a curator resubmits content a curator rejected. The server's classifier
 * passes the review it already `decided` the fact by, which publishes it the same way.
 */
export async function submitFact(
  deps: SubmitDeps,
  actor: Actor,
  input: SubmitFactInput,
  decided?: Review,
): Promise<{ fact: Fact; created: boolean }> {
  const { kind, curation } = input
  if (curation) requireCurator(actor.principal)
  const spec = factKinds[kind]
  const submitted = input.payload as SubmitPayloads[typeof kind]
  let resolved = await resolveNames(deps, kind, submitted)
  // A submitted inventory may name new senses without ids; assignSenseIds gives them theirs.
  const oriented = orientOf(kind, input.subject_id, resolved.payload)
  const subjectId = oriented.subjectId
  const subjectType = subjectTypeOf(kind, oriented.payload)
  const subject = await subjectNode[subjectType](deps, subjectId)
  if (!subject) {
    throw new InvalidReferenceError(`A ${kind} fact is about a ${subjectType}; ${subjectId} is not one.`)
  }
  // The nodes it named by text and that do not exist are created only once it fits its subject.
  if (resolved.missing.lemmas.length > 0 || resolved.missing.sentences.length > 0) {
    if (spec.admit) await assertAdmitted(kind, oriented.payload, subject, resolved.named)
    resolved = await createNamed(deps, actor, kind, submitted, resolved, deps.clock.now().toISOString())
  }
  const payload = orientOf(kind, input.subject_id, resolved.payload).payload
  const { entryId, pos } = subject
  if (spec.subjectPos && !(pos && spec.subjectPos.includes(pos))) {
    throw new InvalidReferenceError(
      `A ${kind} fact is about a sense whose part of speech is ${spec.subjectPos.join(', ')}; this one is ${pos ?? 'an entry'}.`,
    )
  }
  const topic = topicOf(kind, payload)
  if (topic) await assertLeafTopic(deps, topic)
  const picture = mediaOf(kind, payload)
  if (picture && !(await deps.media.has(picture))) {
    throw new InvalidReferenceError(`Picture ${picture} is not stored; upload it with POST /manage/v1/media first.`)
  }
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
  if (!mayCurate(actor.principal)) {
    if (await deps.facts.findCuratedRejection(kind, subjectId, contentKey)) {
      throw new CuratedFactError('A curator rejected this fact; only a curator may submit it again.')
    }
    const rejected = await deps.facts.findRejected(kind, subjectId, contentKey)
    if (rejected) {
      throw new RejectedBeforeError(
        `Review already rejected this content (${rejected.id}): ${rejected.review?.reason ?? 'no reason recorded'} Fix what it names instead of resending it.`,
      )
    }
    if (
      kind === 'senses' &&
      entryId &&
      (await deps.facts.listLive('senses', entryId)).some((fact) => fact.status === 'published')
    ) {
      throw new InventorySettledError(
        "This entry's sense inventory is published, so its senses are fixed; reference them, or leave a note for a curator.",
      )
    }
  }
  if (targetSense) await assertTargetShown(deps, targetSense.id, targetSense.entryId)
  if (subjectType === 'sense' && entryId) await assertTargetShown(deps, subjectId as SenseId, entryId)

  if (spec.admit) await assertAdmitted(kind, payload, subject, resolved.named)
  await assertReferencesLive(deps, referencesOf(kind, payload))
  const factId = deps.ids.fact()
  if (targetSense && entryId) {
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
  const stored =
    kind === 'senses' && entryId
      ? await assignSenseIds(deps, entryId, payload as FactPayloads['senses'], actor, now)
      : payload
  const draft = {
    id: factId,
    kind,
    subjectId,
    objectId: objectOf(kind, payload),
    contentKey,
    payload: stored,
    status: 'pending',
    supersedesId,
    author: principalRef(actor.principal),
    review: null,
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
  if (created && decided) return { fact: await publishDecided(deps, actor, fact, decided), created }
  await refreshEntries(deps, [subjectId, objectOf(kind, payload)])
  if (created) await deps.reviewQueue.enqueue([{ factId: fact.id, traceId: actor.traceId }])
  return { fact, created }
}

/**
 * Names every sense of a submitted inventory by id: a kept sense keeps its own, and a new one gets
 * the sense row of its part of speech and gloss, created now (an inventory review that rejects it
 * leaves the row unlisted, so it never shows).
 */
async function assignSenseIds(
  deps: Pick<Deps, 'nodes' | 'ids'>,
  entryId: EntryId,
  { senses }: FactPayloads['senses'],
  actor: Actor,
  at: string,
): Promise<FactPayloads['senses']> {
  const fresh = senses.filter((sense) => !sense.id)
  const created = await deps.nodes.insertSenses(
    fresh.map((sense) => ({
      sense: { id: deps.ids.sense(), entryId, pos: sense.pos, createdBy: principalRef(actor.principal), createdAt: at },
      creationKey: textKey(sense.gloss),
    })),
  )
  let next = 0
  return {
    senses: senses.map((sense) => {
      if (sense.id) return { ...sense, id: sense.id }
      const row = created[next++]
      if (!row) throw new Error(`No sense row was stored for a new sense of entry ${entryId}.`)
      return { ...sense, id: row.id }
    }),
  }
}

/**
 * A relation's end is a sense its entry's published inventory lists, on a live entry: anything
 * else never shows, so the pass names the word in blocked_on instead.
 */
async function assertTargetShown(deps: SubjectDeps, sense: SenseId, entryId: EntryId): Promise<void> {
  const [admission, listed] = await Promise.all([deps.nodes.admission(entryId), publishedSenses(deps, entryId)])
  if (!admission.live || !listed.some((candidate) => candidate.id === sense)) {
    throw new InvalidReferenceError(
      `Sense ${sense} is not listed by a published inventory of a live entry, so nothing can link to it yet; name the word in blocked_on and complete the item.`,
    )
  }
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

/** Publishes a new pending fact the server classified with the review it was decided by. */
async function publishDecided(deps: SubmitDeps, actor: Actor, fact: Fact, review: Review): Promise<Fact> {
  const at = deps.clock.now().toISOString()
  const applied = await recordDecision(deps, fact, { event: 'publish', from: ['pending'], at, review }, actor.traceId)
  if (!applied) throw new ConflictError('The fact changed while it was being published.')
  return getFact(deps, fact.id)
}

/** Runs the kind's write rule against the subject as it is now; only for a kind that has one. */
async function assertAdmitted<K extends FactKind>(
  kind: K,
  payload: FactPayloads[K],
  subject: SubjectNode<SubjectTypeOf[K]>,
  named: NamedNodes,
): Promise<void> {
  const refusal = admissionOf(kind, payload, await subject.admission(), named)
  if (refusal) throw new InvalidReferenceError(refusal)
}

/** Each lemma the payload names is a live entry's; a read before the write, as `admit` is. */
async function assertReferencesLive(deps: SubjectDeps, lemmas: readonly string[]): Promise<void> {
  for (const lemma of lemmas) {
    const entry = await deps.nodes.findEntryByLemma(lemma as Lemma)
    const live = entry && (await deps.nodes.admission(entry.id)).live
    if (!live) {
      throw new InvalidReferenceError(
        `${JSON.stringify(lemma)} is not the lemma of a live entry; a base names an entry exactly as it is spelled. Leave the lemma out, or name the word in blocked_on.`,
      )
    }
  }
}

/**
 * What a link's end rule sees of a sense: whether its entry's inventory ranks it extra, its
 * register, and its entry's lemma and live spelling variants.
 */
async function linkEnd(deps: SubjectDeps, { sense, entry }: SenseEnd): Promise<LinkEnd> {
  const [node, senses, forms] = await Promise.all([
    deps.nodes.findEntry(entry),
    inventoryOf(deps, entry),
    deps.facts.listLive('form', entry),
  ])
  if (!node) throw new Error(`Sense ${sense} belongs to entry ${entry}, which does not exist.`)
  const listed = senses.find((candidate) => candidate.id === sense)
  return {
    sense,
    rare: listed?.rank === 'extra',
    register: listed?.register ?? null,
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
  subjectId: string,
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
  subjectId: string,
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
    await assertAdmitted(fact.kind, fact.payload, await existingSubject(deps, fact), await namedNodesOf(deps, fact))
  if (reviving) await assertReferencesLive(deps, referencesOf(fact.kind, fact.payload))
  const target = targetOf(fact.kind, fact.payload)
  if (reviving && target) {
    const link = await storedLink(deps, fact, target)
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
