import { isCurated } from '@server/domain/curation'
import { type Fact, type FactOf, isKind } from '@server/domain/fact'
import { factKinds, type JevQuestions, type Link, type LlmPrompt, slotOf } from '@server/domain/fact-kinds'
import { isLive } from '@server/domain/fact-lifecycle'
import { levelOfRank, openItemStatus } from '@server/domain/monitor'
import type { EntryNode, SenseNode, SentenceNode } from '@server/domain/nodes'
import type { PrincipalRef } from '@server/domain/principal'
import { type PublicViewRecord, STEM_ROLES } from '@server/domain/public-view'
import { levelRank } from '@server/domain/reference'
import { EXACT_LEMMA_TIER, fieldTier, LEMMA_PREFIX_TIER, SEARCH_TIERS } from '@server/domain/search'
import { isMultiword, type Lemma, textKey } from '@server/domain/term'
import type { TicketRecord } from '@server/domain/tickets'
import { type TopicNode, topicsUnder } from '@server/domain/topics'
import { passKey, type WorkItem, type WorkLease } from '@server/domain/work'
import type { Deps } from '@server/usecases/deps'
import { ConflictError } from '@server/usecases/errors'
import type {
  AgentRecord,
  DecisionAnswers,
  LlmJudgement,
  NodeRepo,
  ReviewJob,
  ServiceRecord,
  StaleWork,
  StoredMember,
  StoredTaggedSense,
  TicketRepo,
  ViewLookup,
  WithEntry,
  WorkRepo,
  WorkScores,
} from '@server/usecases/ports'
import type { AgentId } from '@shared/agents'
import type { EntryId, FactId, FactKind, FactStatus, Pos, SenseId, SentenceId, TopicId } from '@shared/facts'
import type { MediaId } from '@shared/media'
import type { CefrLevel, LemmaReference, ReferenceSource } from '@shared/reference'
import type { ServiceId } from '@shared/services'
import type { TicketId } from '@shared/tickets'
import { MAX_PASSES, type WorkItemId, type WorkLeaseId, type WorkType } from '@shared/work'

// In-memory stand-ins for every port, shared by the use-case tests. They model the persistence
// guarantees the real repos give (live uniqueness, conditional writes, compare-and-set, revision
// bumps) so tests exercise the use cases, not the fakes.

type DecisionModelName = keyof Deps['decision']

/** An entry's worklist row: its admission, its stored scores, and the revisions its rescore and view describe. */
export interface FakeWorklistRow extends WorkScores {
  live: boolean
  batch: number | null
  revision: number
  scoredRevision: number
  viewRevision: number
  lastWorkedAt: string | null
}

/** A completed pass on a slot, as `work_passes` stores it. */
export interface FakePass {
  entryId: EntryId
  type: WorkType
  subjectId: string
  note: string
  holder: PrincipalRef
  at: string
}

/** An attempt a completed lease recorded at an item, as `work_attempts` stores it. */
export interface FakeAttempt {
  itemId: WorkItemId
  holder: PrincipalRef
  note: string | null
  outcome: string
}

export type DecisionAnswer = (
  questions: JevQuestions,
  state: Readonly<Record<string, string | readonly string[]>>,
) => DecisionAnswers | Promise<DecisionAnswers>

export interface FakeWorld {
  deps: Deps
  entries: EntryNode[]
  senses: SenseNode[]
  sentences: SentenceNode[]
  facts: Fact[]
  /** A slice of the seeded taxonomy: two categories and some of their leaf topics. */
  topics: TopicNode[]
  /** The stored media files by id. */
  media: Map<MediaId, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>
  tickets: TicketRecord[]
  agents: Array<AgentRecord & { keyHash: string }>
  services: Array<ServiceRecord & { keyHash: string }>
  leases: WorkLease[]
  /** The work items, as the work_items table stores them. */
  items: WorkItem[]
  attempts: FakeAttempt[]
  passes: FakePass[]
  /** The lemmas passes were blocked on, by slot. */
  blocks: Array<{ lemma: string; type: WorkType; subjectId: string }>
  /** Each entry's worklist row. */
  work: Map<EntryId, FakeWorklistRow>
  /** Each entry's stored public view rows, as the public view tables hold them. */
  views: Map<EntryId, PublicViewRecord>
  queued: ReviewJob[]
  /** Imported reference data by exact lemma; a lemma absent here has none. */
  references: Map<string, LemmaReference>
  referenceSources: ReferenceSource[]
  /** Client keys the rate limiters refuse. */
  limitedClients: Set<string>
  /** What the edge cache holds, by key. */
  cachedResponses: Map<string, Response>
  decisionCalls: Array<{ model: DecisionModelName; questions: JevQuestions; state: Readonly<Record<string, unknown>> }>
  llmCalls: LlmPrompt[]
  /** The pictures shown with each LLM call, in the order of llmCalls. */
  llmPictures: Array<readonly string[]>
  setNow(iso: string): void
  answerDecision(model: DecisionModelName, answer: DecisionAnswer): void
  answerLlm(answer: (prompt: LlmPrompt) => LlmJudgement | Promise<LlmJudgement>): void
  /** Sets the JSON object the LLM answers a prompt that asks it to choose. */
  chooseLlm(answer: (prompt: LlmPrompt) => unknown): void
  /** Every decision model scores every question this low (and the LLM fails) until passReviews. */
  failReviews(): void
  /** Every reviewer passes what it is asked, as it does by default. */
  passReviews(): void
}

const ALREADY_CORRECTED =
  'The fact this corrects already has a live correction; retract that one or wait for its review.'

const topic = (id: string, parentId: string | null, nameEn: string, position: number): TopicNode => ({
  id: id as TopicId,
  parentId: parentId as TopicId | null,
  nameEn,
  nameZh: `${nameEn} (zh)`,
  position,
  imageId: null,
})

export const fakeTopics: readonly TopicNode[] = [
  topic('home', null, 'Home', 1),
  topic('body-health', null, 'Body and health', 0),
  topic('furniture', 'home', 'Furniture', 0),
  topic('kitchen', 'home', 'In the kitchen', 1),
  topic('hospital-doctor', 'body-health', 'At the doctor and hospital', 1),
  topic('body-parts', 'body-health', 'Parts of the body', 0),
  topic('dentist', 'body-health', 'At the dentist', 2),
]

/** A stand-in for the SHA-256 digest: equal documents, equal digests. */
function fakeDigest(json: string): string {
  let hash = 0
  for (const char of json) hash = (Math.imul(hash, 31) + (char.codePointAt(0) ?? 0)) | 0
  return (hash >>> 0).toString(16)
}

const scoring = (questions: JevQuestions, score: number, model: string): DecisionAnswers => ({
  model,
  answers: Object.fromEntries(Object.keys(questions).map((key) => [key, score])),
})
const passingDecision =
  (model: string): DecisionAnswer =>
  (questions) =>
    scoring(questions, 0.95, model)
const passingLlm = (): LlmJudgement => ({ model: 'llm-test', verdict: 'pass', confidence: 0.9, reason: 'Looks right.' })

export function fakeWorld(): FakeWorld {
  let now = new Date('2026-01-01T00:00:00.000Z')
  let counter = 0
  const nextId = <T extends string>(group = '8000') => {
    counter += 1
    return `00000000-0000-4000-${group}-${String(counter).padStart(12, '0')}` as T
  }
  const decisionAnswers: Record<DecisionModelName, DecisionAnswer> = {
    jev: passingDecision('jev-test'),
    luna: passingDecision('luna-test'),
  }
  let llmAnswer: (prompt: LlmPrompt) => LlmJudgement | Promise<LlmJudgement> = passingLlm
  /** What the LLM answers a prompt asking it to choose: a JSON object the caller decodes. */
  let llmChoice: (prompt: LlmPrompt) => unknown = () => ({})
  /** When the reconciler last re-enqueued each pending fact (facts.review_enqueued_at). */
  const reviewEnqueuedAt = new Map<string, string>()

  const world: Omit<FakeWorld, 'deps'> = {
    entries: [],
    senses: [],
    sentences: [],
    facts: [],
    topics: [...fakeTopics],
    media: new Map(),
    tickets: [],
    references: new Map(),
    referenceSources: [],
    agents: [],
    services: [],
    leases: [],
    items: [],
    attempts: [],
    passes: [],
    blocks: [],
    work: new Map(),
    views: new Map(),
    queued: [],
    limitedClients: new Set(),
    cachedResponses: new Map(),
    decisionCalls: [],
    llmCalls: [],
    llmPictures: [],
    setNow: (iso) => {
      now = new Date(iso)
    },
    answerDecision: (model, answer) => {
      decisionAnswers[model] = answer
    },
    answerLlm: (answer) => {
      llmAnswer = answer
    },
    chooseLlm: (answer) => {
      llmChoice = answer
    },
    failReviews: () => {
      decisionAnswers.jev = (questions) => scoring(questions, 0.05, 'jev-test')
      decisionAnswers.luna = (questions) => scoring(questions, 0.05, 'luna-test')
      llmAnswer = () => ({ model: 'llm-test', verdict: 'fail', confidence: 0.9, reason: 'Wrong.' })
    },
    passReviews: () => {
      decisionAnswers.jev = passingDecision('jev-test')
      decisionAnswers.luna = passingDecision('luna-test')
      llmAnswer = passingLlm
    },
  }

  const live = (fact: Fact) => isLive(fact.status)
  const entryById = (id: string) => world.entries.find((entry) => entry.id === id)
  const senseById = (id: string | null) => world.senses.find((sense) => sense.id === id)
  const withLemma = (sense: SenseNode) => {
    const entry = entryById(sense.entryId)
    if (!entry) throw new Error(`Sense ${sense.id} belongs to no entry.`)
    return { ...sense, lemma: entry.lemma }
  }
  const rowOf = (entryId: EntryId): FakeWorklistRow => {
    const row = world.work.get(entryId)
    if (!row) throw new Error(`Entry ${entryId} has no worklist row.`)
    return row
  }
  const newRow = (entryId: EntryId) => {
    if (world.work.has(entryId)) return
    world.work.set(entryId, {
      live: false,
      batch: null,
      completeness: 0,
      credibility: 1,
      slots: { total: 0, published: 0, pending: 0 },
      revision: 0,
      scoredRevision: 0,
      viewRevision: 0,
      lastWorkedAt: null,
    })
  }
  const bump = (entryIds: Iterable<EntryId>) => {
    for (const entryId of new Set(entryIds)) {
      const row = world.work.get(entryId)
      if (row) row.revision += 1
    }
  }
  /** The learner priority of the entry's lemma, as the worklist row stores it. */
  const priorityOf = (entry: EntryNode) => {
    const reference = world.references.get(entry.lemma)
    const levels = reference?.cefr.map((cefr) => levelRank(cefr.level)) ?? []
    return { levelRank: levels.length > 0 ? Math.min(...levels) : null, zipf: reference?.frequency?.zipf ?? null }
  }
  /**
   * The entry a node is or belongs to: an entry, a sense's entry, or for an example or collocation
   * fact (what a translation is about) the entry of its sense.
   */
  const entryIdOfNode = (nodeId: string): EntryId | undefined => ownersOfNode(nodeId)[0]
  /** The live phrases lists that name a sentence a saying. */
  const sayingLists = (sentenceId: string) =>
    world.facts
      .filter(isKind('phrases'))
      .filter(
        (fact) =>
          live(fact) && fact.payload.phrases.some((item) => item.type === 'saying' && item.sentence_id === sentenceId),
      )
  /** The live examples that name a sentence. */
  const sentenceExamples = (sentenceId: string) =>
    world.facts.filter((fact) => fact.kind === 'example' && fact.objectId === sentenceId && live(fact))
  /**
   * The entries a node is or belongs to: an entry, a sense's entry, a collocation's entry, and for a
   * sentence each entry whose example or phrases list names it, as `entryOf` and `ownersOf` read them.
   */
  const ownersOfNode = (nodeId: string): EntryId[] => {
    if (entryById(nodeId)) return [nodeId as EntryId]
    const sense = senseById(nodeId)
    if (sense) return [sense.entryId]
    if (world.sentences.some((sentence) => sentence.id === nodeId)) {
      const all = world.facts.filter((fact) => fact.kind === 'example' && fact.objectId === nodeId)
      return [
        ...new Set([
          ...all.flatMap((fact) => senseById(fact.subjectId)?.entryId ?? []),
          ...sayingLists(nodeId).map((fact) => fact.subjectId as EntryId),
        ]),
      ]
    }
    const fact = world.facts.find((candidate) => candidate.id === nodeId)
    const owner = fact && senseById(fact.subjectId)?.entryId
    return owner ? [owner] : []
  }
  const isLiveEntry = (entryId: string) => world.work.get(entryId as EntryId)?.live === true
  /** The entries whose relations link to a sense that is, or belongs to, one of these nodes. */
  const linkedEntries = (nodeIds: readonly string[]) => {
    const nodeSenses = new Set<string>(
      world.senses
        .filter((sense) => nodeIds.includes(sense.id) || nodeIds.includes(sense.entryId))
        .map((sense) => sense.id),
    )
    const ends = world.facts
      .filter((fact) => fact.kind === 'relation')
      .flatMap((fact) => [
        ...(nodeSenses.has(fact.subjectId) ? [fact.objectId] : []),
        ...(nodeSenses.has(fact.objectId ?? '') ? [fact.subjectId] : []),
      ])
    return world.senses.filter((sense) => ends.includes(sense.id)).map((sense) => sense.entryId)
  }
  /** The entries a base part names in these morphology facts. */
  const namedBases = (named: readonly Fact[]) => {
    const lemmas = named
      .filter(isKind('morphology'))
      .flatMap((fact) => fact.payload.parts.flatMap((part) => (part.role === 'base' && part.lemma ? [part.lemma] : [])))
    return world.entries.filter((entry) => lemmas.includes(entry.lemma)).map((entry) => entry.id)
  }
  /** Every row a write about these nodes can make stale, as `relatedWorklistRows` selects them. */
  const relatedRows = (nodeIds: readonly string[]) =>
    new Set<EntryId>([
      ...nodeIds.flatMap(ownersOfNode),
      ...linkedEntries(nodeIds),
      ...namedBases(world.facts.filter((fact) => nodeIds.includes(fact.subjectId))),
    ])
  /** What the real fact writes batch with them: the nodes' entries, and the linked entries and bases of the fact. */
  const touchFact = (fact: Fact) => {
    const nodes = [fact.subjectId, ...(fact.objectId ? [fact.objectId] : [])]
    bump(nodes.flatMap(ownersOfNode))
    if (fact.kind === 'senses') bump(linkedEntries([fact.subjectId]))
    bump(namedBases([fact]))
  }
  const staleOf = (entryId: EntryId): StaleWork => ({ entryId, revision: rowOf(entryId).revision })
  const isStale = (entryId: EntryId) => rowOf(entryId).revision !== rowOf(entryId).scoredRevision
  const isViewStale = (entryId: EntryId) => rowOf(entryId).revision !== rowOf(entryId).viewRevision

  const findLive = (kind: string, subjectId: string, contentKey: string) =>
    world.facts.find(
      (fact) => fact.kind === kind && fact.subjectId === subjectId && fact.contentKey === contentKey && live(fact),
    ) ?? null
  const heldLive = (fact: Fact, excluding: string | null) =>
    world.facts.filter(
      (other) =>
        other.kind === fact.kind && other.subjectId === fact.subjectId && live(other) && other.id !== excluding,
    ).length
  // The D1 partial unique indexes: live content, an exclusive slot's holder and pending fact, and
  // one live correction per original. Returns the conflict message the repo maps a violation to.
  const holdsSlot = (fact: Fact) =>
    fact.status === 'published' || (fact.status === 'pending' && fact.supersedesId === null)
  const violatedIndex = (facts: Fact[], candidate: Fact): string | null => {
    const others = facts.filter(
      (other) => other.id !== candidate.id && other.kind === candidate.kind && other.subjectId === candidate.subjectId,
    )
    const correctsSame = (other: Fact) =>
      candidate.supersedesId !== null && other.supersedesId === candidate.supersedesId && live(other) && live(candidate)
    if (others.some(correctsSame)) return ALREADY_CORRECTED
    const takesSlot = (other: Fact) => {
      if (live(other) && live(candidate) && other.contentKey === candidate.contentKey) return true
      if (factKinds[candidate.kind].cardinality === 'many') return false
      if (slotOf(other.kind, other.payload as never) !== slotOf(candidate.kind, candidate.payload as never))
        return false
      return (
        (holdsSlot(other) && holdsSlot(candidate)) || (other.status === 'pending' && candidate.status === 'pending')
      )
    }
    return others.some(takesSlot) ? 'Another live fact already holds this slot.' : null
  }
  const isPublished = (id: string) => world.facts.some((fact) => fact.id === id && fact.status === 'published')
  const paged = <T>(items: T[], limit: number, cursor: string | undefined) => {
    const start = cursor ? Number(cursor) : 0
    const slice = items.slice(start, start + limit)
    return { items: slice, nextCursor: start + limit < items.length ? String(start + limit) : null }
  }
  const withEntry = <T>(record: T, nodeId: string): WithEntry<T> => {
    const entry = entryById(entryIdOfNode(nodeId) ?? '')
    if (!entry) throw new Error(`Node ${nodeId} belongs to no entry.`)
    return { ...record, entry: { id: entry.id, lemma: entry.lemma } }
  }
  const factWithEntry = (fact: Fact) => withEntry(fact, fact.subjectId)
  const ticketWithEntry = (ticket: TicketRecord) => {
    if (ticket.targetType === 'lemma') return { ...ticket, entry: null }
    const fact = ticket.targetType === 'fact' ? world.facts.find((candidate) => candidate.id === ticket.target) : null
    const entry = entryById(entryIdOfNode(fact?.subjectId ?? ticket.target) ?? '')
    return { ...ticket, entry: entry ? { id: entry.id, lemma: entry.lemma } : null }
  }
  const openTicket = (ticket: TicketRecord) => {
    const open = world.tickets.find(
      (candidate) =>
        candidate.status === 'open' &&
        candidate.type === ticket.type &&
        candidate.targetType === ticket.targetType &&
        candidate.target === ticket.target,
    )
    if (open) return open
    world.tickets.push(ticket)
    return ticket
  }

  /** Built views in lemma order, as the view's lemma index reads them. */
  const builtViews = () => [...world.views.values()].sort((a, b) => a.document.lemma.localeCompare(b.document.lemma))
  const viewLookup = (entryId: EntryId): ViewLookup => {
    const record = world.views.get(entryId)
    const json = record && JSON.stringify(record.document)
    return {
      stale: isViewStale(entryId) ? { entryId, revision: rowOf(entryId).revision } : null,
      view: json ? { json, digest: fakeDigest(json) } : null,
    }
  }

  const creationKeys = new Map<SenseId, string>()
  const admitEntries = (lemmas: readonly Lemma[], createdBy: PrincipalRef, at: string) =>
    lemmas.map((lemma) => {
      const existing = world.entries.find((entry) => entry.lemma === lemma)
      if (existing) return existing
      const entry: EntryNode = { id: nextId<EntryId>(), lemma, createdBy, createdAt: at }
      world.entries.push(entry)
      newRow(entry.id)
      return entry
    })
  const goLive = (entryIds: readonly EntryId[], batch: number | null) => {
    for (const entryId of entryIds) {
      const row = rowOf(entryId)
      row.live = true
      row.batch = row.batch ?? batch
      row.revision += 1
    }
  }

  const nodes: NodeRepo = {
    findEntryByLemma: async (lemma) => world.entries.find((entry) => entry.lemma === lemma) ?? null,
    findEntry: async (id) => entryById(id) ?? null,
    insertEntry: async (entry) => {
      const existing = world.entries.find((candidate) => candidate.lemma === entry.lemma)
      if (existing) return existing
      world.entries.push(entry)
      newRow(entry.id)
      return entry
    },
    findEntries: async (ids) => world.entries.filter((entry) => ids.includes(entry.id)),
    findEntriesByLemmas: async (lemmas) => world.entries.filter((entry) => lemmas.includes(entry.lemma)),
    ensureEntries: async (lemmas, createdBy, at) => admitEntries(lemmas, createdBy, at),
    listNamingLists: async (entryId) =>
      world.facts
        .filter(isKind('phrases'))
        .filter(
          (fact) =>
            fact.status === 'published' &&
            fact.payload.phrases.some((item) => item.type !== 'saying' && item.entry_id === entryId),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .map((fact) => fact.id),
    findSentence: async (id) => world.sentences.find((sentence) => sentence.id === id) ?? null,
    findSentences: async (ids) => world.sentences.filter((sentence) => ids.includes(sentence.id)),
    findSentencesByTexts: async (texts) => {
      const keys = texts.map(textKey)
      return world.sentences.filter((sentence) => keys.includes(textKey(sentence.text)))
    },
    insertSentences: async (rows) =>
      rows.map((row) => {
        const existing = world.sentences.find((sentence) => textKey(sentence.text) === textKey(row.text))
        if (existing) return existing
        world.sentences.push(row)
        return row
      }),
    listSentenceUses: async (id) => ({
      examples: sentenceExamples(id).flatMap((fact) => {
        const sense = senseById(fact.subjectId)
        const entry = sense && entryById(sense.entryId)
        return sense && entry
          ? [{ factId: fact.id, status: fact.status, senseId: sense.id, entryId: entry.id, lemma: entry.lemma }]
          : []
      }),
      sayings: sayingLists(id).flatMap((fact) => {
        const entry = entryById(fact.subjectId)
        return entry ? [{ factId: fact.id, status: fact.status, entryId: entry.id, lemma: entry.lemma }] : []
      }),
    }),
    findSense: async (id) => {
      const sense = senseById(id)
      return sense ? withLemma(sense) : null
    },
    listSenses: async (entryId) => world.senses.filter((sense) => sense.entryId === entryId),
    insertSenses: async (rows) =>
      rows.map(({ sense, creationKey }) => {
        const existing = world.senses.find(
          (candidate) =>
            candidate.entryId === sense.entryId &&
            candidate.pos === sense.pos &&
            creationKeys.get(candidate.id) === creationKey,
        )
        if (existing) return existing
        world.senses.push(sense)
        creationKeys.set(sense.id, creationKey)
        return sense
      }),
    admission: async (entryId) => {
      const { live: admitted, batch } = rowOf(entryId)
      return { live: admitted, batch }
    },
    admit: async (lemmas, batch, createdBy, at) => {
      const admitted = admitEntries(lemmas, createdBy, at)
      goLive(
        admitted.map((entry) => entry.id),
        batch,
      )
      return admitted
    },
    setPhrasesLive: async (alive, dead, batch) => {
      goLive(alive, batch)
      const named = (entryId: string) =>
        world.facts
          .filter(isKind('phrases'))
          .some(
            (fact) =>
              fact.status === 'published' &&
              fact.payload.phrases.some((item) => item.type !== 'saying' && item.entry_id === entryId),
          )
      for (const entryId of dead) {
        const entry = entryById(entryId)
        if (!entry || named(entry.id)) continue
        const row = rowOf(entryId)
        row.live = false
        row.revision += 1
      }
    },
    listUnadmittedPhraseLists: async (limit) =>
      world.facts
        .filter(isKind('phrases'))
        .filter(
          (fact) =>
            fact.status === 'published' &&
            fact.payload.phrases.some((item) => item.type !== 'saying' && !rowOf(item.entry_id).live),
        )
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
        .slice(0, limit)
        .map((fact) => fact.id),
    loadEntrySnapshot: async (entry) => {
      const own = world.senses.filter((sense) => sense.entryId === entry.id)
      const ownIds = new Set<string>(own.map((sense) => sense.id))
      const senseFacts = new Set<string>(
        world.facts.filter((fact) => ownIds.has(fact.subjectId)).map((fact) => fact.id),
      )
      const ownLists = world.facts.filter(isKind('phrases')).filter((fact) => fact.subjectId === entry.id)
      const sentenceIds = new Set<string>([
        ...world.facts
          .filter((fact) => fact.kind === 'example' && ownIds.has(fact.subjectId))
          .flatMap((fact) => fact.objectId ?? []),
        ...ownLists.flatMap((fact) =>
          fact.payload.phrases.flatMap((item) => (item.type === 'saying' ? [item.sentence_id] : [])),
        ),
      ])
      const phraseEntryIds = new Set<string>(
        ownLists.flatMap((fact) =>
          fact.payload.phrases.flatMap((item) => (item.type === 'saying' ? [] : [item.entry_id])),
        ),
      )
      const facts = world.facts.filter(
        (fact) =>
          fact.subjectId === entry.id ||
          ownIds.has(fact.subjectId) ||
          senseFacts.has(fact.subjectId) ||
          sentenceIds.has(fact.subjectId),
      )
      const naming = world.facts
        .filter(isKind('phrases'))
        .filter((fact) => fact.status === 'published' && !fact.payload.migrated)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .flatMap((fact) => fact.payload.phrases)
        .find((item) => item.type !== 'saying' && item.entry_id === entry.id)
      const outgoing = facts.filter((fact) => fact.kind === 'relation').map((fact) => fact.objectId)
      const incoming = world.facts.filter((fact) => fact.kind === 'relation' && ownIds.has(fact.objectId ?? ''))
      const neighborEntries = new Set<EntryId>(
        world.senses
          .filter((sense) => outgoing.includes(sense.id) || incoming.some((fact) => fact.subjectId === sense.id))
          .map((sense) => sense.entryId)
          .filter((entryId) => entryId !== entry.id),
      )
      const row = rowOf(entry.id)
      const family = [
        ...new Set(
          world.facts
            .filter(isKind('morphology'))
            .filter(
              (fact) =>
                live(fact) &&
                fact.subjectId !== entry.id &&
                isLiveEntry(fact.subjectId) &&
                fact.payload.parts.some((part) => part.role === 'base' && part.lemma === entry.lemma),
            )
            .flatMap((fact) => entryById(fact.subjectId)?.lemma ?? []),
        ),
      ].sort()
      return {
        entry: { ...entry, live: row.live },
        batch: row.batch,
        levelRank: priorityOf(entry).levelRank,
        zipf: priorityOf(entry).zipf,
        family,
        phraseType: isMultiword(entry.lemma) && naming && naming.type !== 'saying' ? naming.type : null,
        sentences: new Map(
          world.sentences.filter((sentence) => sentenceIds.has(sentence.id)).map((sentence) => [sentence.id, sentence]),
        ),
        phraseEntries: new Map(
          world.entries
            .filter((candidate) => phraseEntryIds.has(candidate.id))
            .map((candidate) => [candidate.id, candidate.lemma]),
        ),
        senses: own,
        facts,
        incoming,
        passes: new Set(
          world.passes.filter((pass) => pass.entryId === entry.id).map((pass) => passKey(pass.type, pass.subjectId)),
        ),
        neighbors: {
          inventories: world.facts.filter(
            (fact) => fact.kind === 'senses' && neighborEntries.has(fact.subjectId as EntryId),
          ),
          lemmas: new Map([...neighborEntries].map((id) => [id, entryById(id)?.lemma ?? ''])),
          liveEntries: new Set([...neighborEntries].filter(isLiveEntry)),
        },
      }
    },
    listEntrySummaries: async ({ prefix, level, stuck }, page, at) => {
      const itemsOf = (entry: EntryNode) => world.items.filter((item) => item.entryId === entry.id)
      const summaries = world.entries
        .filter((entry) => entry.lemma.startsWith(prefix))
        .filter((entry) => !level || priorityOf(entry).levelRank === levelRank(level))
        .filter((entry) => !stuck || itemsOf(entry).some((item) => item.attempts >= MAX_PASSES))
        .sort((a, b) => a.lemma.localeCompare(b.lemma))
        .map((entry) => {
          const own = new Set<string>(world.senses.filter((sense) => sense.entryId === entry.id).map(({ id }) => id))
          const facts = world.facts.filter((fact) => fact.subjectId === entry.id || own.has(fact.subjectId))
          const counts = Object.fromEntries(
            (['pending', 'published', 'rejected', 'superseded', 'retracted'] as FactStatus[]).map((status) => [
              status,
              facts.filter((fact) => fact.status === status).length,
            ]),
          ) as Record<FactStatus, number>
          const published = facts.filter(isKind('senses')).find((fact) => fact.status === 'published')
          const openWork = { total: 0, in_progress: 0, waiting_on_review: 0, stuck: 0 }
          for (const item of itemsOf(entry)) {
            const status = openItemStatus({ ...item, leased: item.lease !== null && item.lease.expiresAt > at })
            if (status !== 'queued') openWork[status] += 1
            openWork.total += 1
          }
          const row = rowOf(entry.id)
          return {
            id: entry.id,
            lemma: entry.lemma,
            live: row.live,
            sense_count: published?.payload.senses.length ?? 0,
            fact_counts: counts,
            last_worked_at: row.lastWorkedAt,
            created_at: entry.createdAt,
            level: levelOfRank(priorityOf(entry).levelRank),
            completeness: row.completeness,
            credibility: row.credibility,
            slots: row.slots,
            open_work: openWork,
          }
        })
      return paged(summaries, page.limit, page.cursor)
    },
    findLiveForms: async (contentKeys) =>
      world.facts
        .filter((fact): fact is FactOf<'form'> => fact.kind === 'form' && live(fact))
        .filter((fact) => contentKeys.some((key) => fact.contentKey === key || fact.contentKey.startsWith(`${key}|`)))
        .flatMap((fact) => {
          const entry = entryById(fact.subjectId)
          return entry && isLiveEntry(entry.id) ? [{ entry, fact }] : []
        }),
    listLiveCaseVariants: async ({ id, lemma }) =>
      world.entries
        .filter((entry) => entry.id !== id && entry.lemma.toLowerCase() === lemma.toLowerCase())
        .filter((entry) => isLiveEntry(entry.id))
        .map((entry) => entry.lemma)
        .sort(),
  }

  const tickets: TicketRepo = {
    open: async (ticket) => openTicket(ticket),
    find: async (id) => world.tickets.find((ticket) => ticket.id === id) ?? null,
    update: async (next, expectedRevision) => {
      const index = world.tickets.findIndex((ticket) => ticket.id === next.id)
      if (world.tickets[index]?.revision !== expectedRevision) return false
      world.tickets[index] = next
      return true
    },
    findWithEntry: async (id) => {
      const ticket = world.tickets.find((candidate) => candidate.id === id)
      return ticket ? ticketWithEntry(ticket) : null
    },
    list: async ({ status, type }, page) =>
      paged(
        world.tickets
          .filter((ticket) => (!status || ticket.status === status) && (!type || ticket.type === type))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
          .map(ticketWithEntry),
        page.limit,
        page.cursor,
      ),
    countByStatus: async () => {
      const counts = { open: 0, resolved: 0, dismissed: 0 }
      for (const ticket of world.tickets) counts[ticket.status] += 1
      return counts
    },
  }

  /** In the production queue, and free at `at`. */
  const claimable = (item: WorkItem, at: string) =>
    !item.awaiting && item.attempts < MAX_PASSES && (item.lease === null || item.lease.expiresAt <= at)
  const queueOrder = (a: WorkItem, b: WorkItem) =>
    a.rank - b.rank || b.zipfOrder - a.zipfOrder || a.stage - b.stage || a.id.localeCompare(b.id)

  const work: WorkRepo = {
    listStale: async (nodeIds) => [...relatedRows(nodeIds)].filter(isStale).map(staleOf),
    listAnyStale: async (limit) => [...world.work.keys()].filter(isStale).sort().slice(0, limit).map(staleOf),
    countStale: async () => [...world.work.keys()].filter(isStale).length,
    listItems: async (entryId) => world.items.filter((item) => item.entryId === entryId).map((item) => ({ ...item })),
    findItems: async (ids) => world.items.filter((item) => ids.includes(item.id)).map((item) => ({ ...item })),
    saveAssessment: async (stale, scores, { writes, deletes, verdicts }) => {
      const row = rowOf(stale.entryId)
      if (row.revision !== stale.revision) return
      const at = now.toISOString()
      Object.assign(row, scores, { scoredRevision: stale.revision })
      for (const verdict of verdicts) {
        const item = world.items.find((candidate) => candidate.id === verdict.id)
        if (!item) continue
        if (
          verdict.verdict === 'passed' &&
          !world.passes.some((pass) => passKey(pass.type, pass.subjectId) === passKey(item.type, item.subjectId))
        ) {
          world.passes.push({
            entryId: item.entryId,
            type: item.type,
            subjectId: item.subjectId,
            note: item.lastNote ?? 'found none',
            holder: item.lastWorkedBy ?? ('unknown' as PrincipalRef),
            at,
          })
        }
        if (verdict.verdict === 'stuck') {
          openTicket({
            id: nextId<TicketId>('a000'),
            type: 'stuck_work',
            targetType: item.subjectId === item.entryId ? 'entry' : 'sense',
            target: item.subjectId,
            message: `${item.type}: ${item.lastNote ?? 'no note'}`,
            status: 'open',
            resolutionNote: null,
            resolutionFactIds: [],
            revision: 0,
            createdAt: at,
            updatedAt: at,
          })
        }
        for (const attempt of world.attempts) {
          if (attempt.itemId === verdict.id && attempt.outcome === 'waiting_on_review')
            attempt.outcome = verdict.verdict
        }
      }
      const kept = world.items.filter((item) => !deletes.includes(item.id))
      for (const write of writes) {
        const { id, ...values } = write
        const stored = kept.find((item) => item.type === write.type && item.subjectId === write.subjectId)
        if (stored) Object.assign(stored, values)
        else
          kept.push({
            ...values,
            id: id ?? nextId<WorkItemId>('9000'),
            entryId: stale.entryId,
            claimedGap: null,
            lease: null,
            lastWorkedAt: null,
            lastWorkedBy: null,
            lastNote: null,
          })
      }
      world.items.splice(0, world.items.length, ...kept)
    },
    claim: async (draft, types, limit, at) => {
      const queue = world.items.filter((item) => claimable(item, at)).sort(queueOrder)
      const first = queue.find((item) => !types || types.includes(item.type))
      if (!first) return null
      const leased = queue.filter((item) => item.type === first.type).slice(0, limit)
      for (const item of leased) {
        item.lease = { id: draft.id, holder: draft.holder, expiresAt: draft.expiresAt }
        item.claimedGap = item.gap
      }
      const lease: WorkLease = {
        ...draft,
        type: first.type,
        entryIds: [...new Set(leased.map((item) => item.entryId))],
        itemIds: leased.map((item) => item.id),
        claimedAt: at,
      }
      world.leases.push(lease)
      return { lease, items: leased.map((item) => ({ ...item })) }
    },
    findLease: async (id) => world.leases.find((lease) => lease.id === id) ?? null,
    complete: async (lease, worked, at) => {
      const index = world.leases.findIndex(
        (held) => held.id === lease.id && held.holder === lease.holder && held.expiresAt > at,
      )
      if (index < 0) return false
      world.leases.splice(index, 1)
      for (const pass of worked) {
        const item = world.items.find((candidate) => candidate.id === pass.id)
        world.attempts.push({
          itemId: pass.id,
          holder: lease.holder,
          note: pass.note ?? null,
          outcome: item ? 'waiting_on_review' : 'closed',
        })
        if (!item) continue
        if (item.lease?.id === lease.id) {
          Object.assign(item, {
            worked: true,
            foundNone: pass.foundNone,
            lastWorkedAt: at,
            lastWorkedBy: lease.holder,
            lastNote: pass.note ?? null,
          })
        }
        for (const lemma of pass.blockedOn) {
          if (
            !world.blocks.some(
              (block) => block.lemma === lemma && block.subjectId === item.subjectId && block.type === item.type,
            )
          ) {
            world.blocks.push({ lemma, type: item.type, subjectId: item.subjectId })
          }
        }
      }
      for (const item of world.items.filter((candidate) => candidate.lease?.id === lease.id)) item.lease = null
      for (const entryId of lease.entryIds) {
        rowOf(entryId).revision += 1
        rowOf(entryId).lastWorkedAt = at
      }
      return true
    },
    recordPass: async (pass) => {
      const index = world.passes.findIndex((stored) => stored.type === pass.type && stored.subjectId === pass.subjectId)
      if (index >= 0) world.passes[index] = pass
      else world.passes.push(pass)
      bump([pass.entryId])
    },
    reopenBlocked: async (lemmas) => {
      const keys = new Set(
        world.blocks
          .filter((block) => lemmas.includes(block.lemma as Lemma))
          .map((block) => passKey(block.type, block.subjectId)),
      )
      const reopened = world.passes.filter((pass) => keys.has(passKey(pass.type, pass.subjectId)))
      if (reopened.length === 0) return []
      world.passes.splice(0, world.passes.length, ...world.passes.filter((pass) => !reopened.includes(pass)))
      world.blocks.splice(
        0,
        world.blocks.length,
        ...world.blocks.filter((block) => !lemmas.includes(block.lemma as Lemma)),
      )
      const entryIds = [...new Set(reopened.map((pass) => pass.entryId))]
      bump(entryIds)
      return entryIds
    },
    purgeLeases: async (before) => {
      const expired = world.leases.filter((lease) => lease.expiresAt <= before)
      world.leases.splice(0, world.leases.length, ...world.leases.filter((lease) => lease.expiresAt > before))
      return expired.length
    },
  }

  const deps: Deps = {
    mediaBaseUrl: 'https://media.test',
    nodes,
    tickets,
    work,
    // The console's aggregates are SQL over the work tables, proven by the integration suite; a
    // use-case test of them passes its own fake.
    monitor: new Proxy({} as Deps['monitor'], {
      get: (_target, name) => () => {
        throw new Error(`fakeWorld does not model monitor.${String(name)}; pass the use case its own fake.`)
      },
    }),
    facts: {
      find: async (id) => world.facts.find((fact) => fact.id === id) ?? null,
      findLive: async (kind, subjectId, contentKey) => findLive(kind, subjectId, contentKey),
      findRejected: async (kind, subjectId, contentKey) =>
        world.facts
          .filter(
            (fact) =>
              fact.kind === kind &&
              fact.subjectId === subjectId &&
              fact.contentKey === contentKey &&
              fact.status === 'rejected',
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null,
      listLive: async (kind, subjectId) =>
        world.facts.filter((fact) => fact.kind === kind && fact.subjectId === subjectId && live(fact)),
      insert: async (fact) => {
        const existing = findLive(fact.kind, fact.subjectId, fact.contentKey)
        if (existing) return existing
        const { maxLive } = factKinds[fact.kind]
        const refused =
          violatedIndex(world.facts, fact) !== null ||
          (maxLive !== undefined && heldLive(fact, fact.supersedesId) >= maxLive) ||
          (fact.supersedesId !== null && !isPublished(fact.supersedesId))
        if (!refused) world.facts.push(fact)
        touchFact(fact)
        return refused ? null : fact
      },
      listLiveLinks: async <K extends FactKind>(kind: K, between: readonly [EntryId, EntryId]) =>
        world.facts.flatMap((fact): Link<K>[] => {
          const subject = senseById(fact.subjectId)?.entryId
          const target = senseById(fact.objectId)?.entryId
          if (fact.kind !== kind || !live(fact) || !subject || !target || subject === target) return []
          if (!between.includes(subject) || !between.includes(target)) return []
          const { id, payload, subjectId, objectId } = fact as FactOf<K>
          return [
            {
              id,
              payload,
              subject: { sense: subjectId as SenseId, entry: subject },
              target: { sense: objectId as SenseId, entry: target },
            },
          ]
        }),
      findLiveCorrection: async (id) => world.facts.find((fact) => fact.supersedesId === id && live(fact)) ?? null,
      transition: async ({ id, from, to, at, review, supersede, liveBelow, unsuperseded, originalPublished }) => {
        const fact = world.facts.find((candidate) => candidate.id === id)
        if (!fact) return false
        touchFact(fact)
        if (!from.includes(fact.status)) return false
        if (liveBelow && heldLive(fact, liveBelow.excluding) >= liveBelow.max) return false
        if (unsuperseded && world.facts.some((candidate) => candidate.supersedesId === id && live(candidate)))
          return false
        if (originalPublished && !isPublished(originalPublished)) return false
        const next = { ...fact, status: to, updatedAt: at, review: review ?? fact.review } as Fact
        const retired = world.facts.map(
          (candidate): Fact =>
            candidate.id === supersede && candidate.status === 'published' && next.supersedesId === supersede
              ? { ...candidate, status: 'superseded', updatedAt: at }
              : candidate,
        )
        const violation = violatedIndex(retired, next)
        if (violation) throw new ConflictError(violation)
        world.facts.splice(
          0,
          world.facts.length,
          ...retired.map((candidate) => (candidate.id === id ? next : candidate)),
        )
        touchFact(next)
        return true
      },
      claimStuckBefore: async (cutoff, limit, at) => {
        const ids = world.facts
          .filter(
            (fact) =>
              fact.status === 'pending' && fact.updatedAt < cutoff && (reviewEnqueuedAt.get(fact.id) ?? '') < cutoff,
          )
          .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
          .slice(0, limit)
          .map((fact) => fact.id)
        for (const id of ids) reviewEnqueuedAt.set(id, at)
        return ids
      },
      findCuratedRejection: async (kind, subjectId, contentKey) =>
        world.facts.find(
          (fact) =>
            fact.kind === kind &&
            fact.subjectId === subjectId &&
            fact.contentKey === contentKey &&
            fact.status === 'rejected' &&
            isCurated(fact),
        ) ?? null,
      findWithEntry: async (id) => {
        const fact = world.facts.find((candidate) => candidate.id === id)
        return fact ? factWithEntry(fact) : null
      },
      list: async ({ status, kind, author, lemma, level }, page) => {
        const entryOf = (fact: Fact) => entryById(entryIdOfNode(fact.subjectId) ?? '')
        return paged(
          world.facts
            .filter((fact) => {
              const entry = entryOf(fact)
              return (
                (!status || fact.status === status) &&
                (!kind || fact.kind === kind) &&
                (!author || fact.author === author) &&
                (!lemma || entry?.lemma === lemma) &&
                (!level || (entry !== undefined && priorityOf(entry).levelRank === levelRank(level)))
              )
            })
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
            .map(factWithEntry),
          page.limit,
          page.cursor,
        )
      },
      countByKindAndStatus: async () => {
        const counts = new Map<string, { kind: FactKind; status: FactStatus; count: number }>()
        for (const fact of world.facts) {
          const key = `${fact.kind}/${fact.status}`
          const row = counts.get(key) ?? { kind: fact.kind, status: fact.status, count: 0 }
          counts.set(key, { ...row, count: row.count + 1 })
        }
        return [...counts.values()]
      },
    },
    topics: {
      list: async () => world.topics,
      find: async (id) => world.topics.find((node) => node.id === id) ?? null,
      setImage: async (id, imageId) => {
        world.topics = world.topics.map((node) => (node.id === id ? { ...node, imageId } : node))
      },
    },
    media: {
      put: async (id, bytes, contentType) => {
        if (!world.media.has(id)) world.media.set(id, { bytes, contentType })
      },
      has: async (id) => world.media.has(id),
      get: async (id) => {
        const file = world.media.get(id)
        if (!file) return null
        return { body: new Blob([file.bytes]).stream(), contentType: file.contentType, size: file.bytes.length }
      },
    },
    agents: {
      insert: async (agent, keyHash) => {
        world.agents.push({ ...agent, keyHash })
      },
      find: async (id) => world.agents.find((agent) => agent.id === id) ?? null,
      findByKeyHash: async (keyHash) => world.agents.find((agent) => agent.keyHash === keyHash) ?? null,
      list: async () => world.agents.map(({ keyHash: _hash, ...agent }) => agent),
      revoke: async (id, at) => {
        const agent = world.agents.find((candidate) => candidate.id === id)
        if (agent) agent.revokedAt = at
      },
    },
    services: {
      insert: async (service, keyHash) => {
        world.services.push({ ...service, keyHash })
      },
      find: async (id) => world.services.find((service) => service.id === id) ?? null,
      findByKeyHash: async (keyHash) => world.services.find((service) => service.keyHash === keyHash) ?? null,
      list: async () => world.services.map(({ keyHash: _hash, ...service }) => service),
      revoke: async (id, at) => {
        const service = world.services.find((candidate) => candidate.id === id)
        if (service) service.revokedAt = at
      },
    },
    publicViews: {
      findByLemma: async (lemma) => {
        const entry = world.entries.find((candidate) => candidate.lemma === lemma)
        if (!entry) return null
        const built = [...world.views.entries()].sort(([, a], [, b]) =>
          a.document.lemma.localeCompare(b.document.lemma),
        )
        const own = world.views.get(entry.id)?.morphemes ?? []
        const shares = (record: PublicViewRecord) =>
          record.morphemes.some(
            (part) =>
              STEM_ROLES.includes(part.role) && own.some((mine) => mine.form === part.form && mine.role === part.role),
          )
        return {
          ...viewLookup(entry.id),
          links: {
            phrases: (built.find(([entryId]) => entryId === entry.id)?.[1].document.phrases ?? []).flatMap((phrase) =>
              built.filter(([, record]) => record.document.lemma === phrase.lemma).map(([, r]) => r.document.summary),
            ),
            family: built
              .filter(([entryId, record]) => entryId !== entry.id && shares(record))
              .map(([, record]) => record.document.summary),
            publicParts: [...new Set(own.map((part) => part.form))].filter((form) =>
              built.some(([, record]) => record.document.lemma === form),
            ),
          },
        }
      },
      findBySense: async (id) => {
        const sense = senseById(id)
        return sense ? viewLookup(sense.entryId) : null
      },
      findForms: async (spelling) =>
        builtViews().flatMap((record) =>
          record.forms
            .filter((form) => form.form === spelling)
            .map((form) => ({
              summary: record.document.summary,
              digest: fakeDigest(JSON.stringify(record.document)),
              type: form.type,
              pos: form.pos,
            })),
        ),
      listEntries: async ({ prefix, levels, pos, topics }, sort, page) => {
        const fits = (candidate: { pos: Pos; cefr: CefrLevel | null }) =>
          (pos === null || candidate.pos === pos) &&
          (levels.length === 0 || (candidate.cefr !== null && levels.includes(candidate.cefr)))
        const admitted = builtViews().filter(
          (record) =>
            record.document.lemma.startsWith(prefix) &&
            (topics
              ? record.taggedSenses.some((tag) => topics.includes(tag.topicId) && !tag.rare && fits(tag.summary))
              : pos === null && levels.length === 0
                ? true
                : record.meanings.some(fits)),
        )
        if (sort === 'frequency') admitted.sort((a, b) => a.frequencyOrder - b.frequencyOrder)
        return paged(
          admitted.map((record) => record.document.summary),
          page.limit,
          page.cursor,
        )
      },
      listTaggedSenses: async (topics, sort, page) => {
        const tagged = new Map<string, StoredTaggedSense & { order: number }>()
        for (const record of builtViews()) {
          for (const tag of record.taggedSenses.filter((candidate) => topics.includes(candidate.topicId))) {
            const order = { lemma: 0, frequency: record.frequencyOrder, level: tag.levelOrder }[sort]
            tagged.set(tag.summary.sense_id, {
              summary: tag.summary,
              rare: tag.rare,
              specialized: tag.specialized,
              order,
            })
          }
        }
        const ordered = [...tagged.values()].sort(
          (a, b) =>
            Number(a.specialized) - Number(b.specialized) ||
            a.order - b.order ||
            a.summary.lemma.localeCompare(b.summary.lemma) ||
            a.summary.sense_id.localeCompare(b.summary.sense_id),
        )
        return paged(
          ordered.map(({ summary, rare, specialized }) => ({ summary, rare, specialized })),
          page.limit,
          page.cursor,
        )
      },
      countTagged: async () => {
        const tags = builtViews().flatMap((record) =>
          record.taggedSenses.map((tag) => ({ ...tag, entryId: record.document.id })),
        )
        const countOf = (topicId: TopicId, topics: readonly TopicId[]) => {
          const own = tags.filter((tag) => topics.includes(tag.topicId))
          return {
            topicId,
            senses: new Set(own.map((tag) => tag.summary.sense_id)).size,
            entries: new Set(own.filter((tag) => !tag.rare).map((tag) => tag.entryId)).size,
          }
        }
        return world.topics
          .map((node) => countOf(node.id, topicsUnder(node, world.topics)))
          .filter((count) => count.senses > 0)
      },
      findDocuments: async (lemmas) =>
        builtViews()
          .filter((record) => (lemmas as readonly string[]).includes(record.document.lemma))
          .map((record) => {
            const json = JSON.stringify(record.document)
            return { json, digest: `digest(${json.length}:${record.document.lemma})` }
          }),
      listMembers: async (id, domain, page) => {
        const links = builtViews().flatMap((record) => record.hypernyms)
        const nearest = new Map<string, StoredMember>()
        let frontier: string[] = [id]
        for (let depth = 1; frontier.length > 0; depth += 1) {
          const next = links.filter(
            (link) =>
              frontier.includes(link.broaderSenseId) &&
              (link.domain === null || link.domain === domain) &&
              link.summary.sense_id !== id &&
              !nearest.has(link.summary.sense_id),
          )
          for (const link of next) nearest.set(link.summary.sense_id, { summary: link.summary, depth, parents: [] })
          frontier = [...new Set(next.map((link) => link.summary.sense_id))]
        }
        const ordered = [...nearest.values()].sort(
          (a, b) =>
            a.depth - b.depth ||
            a.summary.lemma.localeCompare(b.summary.lemma) ||
            a.summary.sense_id.localeCompare(b.summary.sense_id),
        )
        for (const member of ordered) {
          member.parents = links
            .filter(
              (link) =>
                link.summary.sense_id === member.summary.sense_id &&
                (link.domain === null || link.domain === domain) &&
                (link.broaderSenseId === id || nearest.has(link.broaderSenseId)),
            )
            .map((link) => link.broaderSenseId)
            .sort()
        }
        return { ...paged(ordered, page.limit, page.cursor), total: ordered.length }
      },
      search: async ({ text, terms, scopes }, page) => {
        const tierOf = (record: PublicViewRecord) => {
          const { lemma } = record.document
          if (lemma === text) return EXACT_LEMMA_TIER
          if (lemma.startsWith(text)) return LEMMA_PREFIX_TIER
          const words = (body: string) => body.toLowerCase().split(/[^\p{L}\p{N}]+/u)
          const tiers = record.searchTexts
            .filter(
              ({ scope, body }) =>
                terms.length > 0 &&
                scopes.includes(scope) &&
                terms.every((term) => words(body).includes(term.toLowerCase())),
            )
            .map(({ field }) => fieldTier(field))
          return tiers.length > 0 ? Math.min(...tiers) : null
        }
        const hits = builtViews().flatMap((record) => {
          const tier = tierOf(record)
          return tier === null ? [] : [{ record, tier }]
        })
        hits.sort((a, b) => a.tier - b.tier || a.record.frequencyOrder - b.record.frequencyOrder)
        return paged(
          hits.map(({ record, tier }) => ({ summary: record.document.summary, match: SEARCH_TIERS[tier] ?? 'lemma' })),
          page.limit,
          page.cursor,
        )
      },
      listStale: async (nodeIds) =>
        [...relatedRows(nodeIds)]
          .filter(isViewStale)
          .map((entryId) => ({ entryId, revision: rowOf(entryId).revision })),
      listAnyStale: async (limit) =>
        [...world.work.keys()]
          .filter(isViewStale)
          .sort()
          .slice(0, limit)
          .map((entryId) => ({ entryId, revision: rowOf(entryId).revision })),
      countStale: async () => [...world.work.keys()].filter(isViewStale).length,
      save: async (stale, record) => {
        const row = rowOf(stale.entryId)
        if (row.revision !== stale.revision) return
        if (record) world.views.set(stale.entryId, record)
        else world.views.delete(stale.entryId)
        row.viewRevision = stale.revision
      },
    },
    decision: {
      jev: {
        ask: async (questions, state) => {
          world.decisionCalls.push({ model: 'jev', questions, state })
          return decisionAnswers.jev(questions, state)
        },
      },
      luna: {
        ask: async (questions, state) => {
          world.decisionCalls.push({ model: 'luna', questions, state })
          return decisionAnswers.luna(questions, state)
        },
      },
    },
    llm: {
      judge: async (prompt, pictures = []) => {
        world.llmCalls.push(prompt)
        world.llmPictures.push(pictures)
        return llmAnswer(prompt)
      },
      answer: async (prompt, pictures = []) => {
        world.llmCalls.push(prompt)
        world.llmPictures.push(pictures)
        return { model: 'llm-test', answer: await llmChoice(prompt) }
      },
    },
    reviewQueue: {
      enqueue: async (jobs) => {
        world.queued.push(...jobs)
      },
    },
    feedbackLimiter: { allow: async (key) => !world.limitedClients.has(key) },
    readLimiter: { allow: async (key) => !world.limitedClients.has(key) },
    serviceReadLimiter: { allow: async (key) => !world.limitedClients.has(key) },
    responseCache: {
      match: async (key) => world.cachedResponses.get(key)?.clone(),
      put: async (key, response) => {
        world.cachedResponses.set(key, response)
      },
    },
    authVerifier: {
      verify: async (token) => ({ sub: token.replace(/^oidc:/, ''), email: null, name: null }),
    },
    agentKeys: {
      randomSecret: () => `secret${counter + 1}`,
      hash: async (key) => `hash(${key})`,
    },
    adminSubjects: new Set(['admin-1']),
    reference: {
      forLemma: async (lemma) => world.references.get(lemma) ?? { frequency: null, cefr: [] },
      listSources: async () => world.referenceSources,
      listCefrLemmasWithoutEntry: async () => {
        const lowest = new Map<string, string>()
        for (const [lemma, reference] of world.references) {
          const levels = reference.cefr.map((cefr) => cefr.level).sort()
          const [first] = levels
          if (first && !world.entries.some((entry) => entry.lemma === lemma)) lowest.set(lemma, first)
        }
        return [...lowest]
          .sort(([a, x], [b, y]) => x.localeCompare(y) || (a < b ? -1 : 1))
          .map(([lemma]) => lemma as Lemma)
      },
    },
    clock: { now: () => now },
    ids: {
      entry: () => nextId<EntryId>(),
      sense: () => nextId<SenseId>(),
      sentence: () => nextId<SentenceId>('b000'),
      fact: () => nextId<FactId>(),
      ticket: () => nextId<TicketId>(),
      agent: () => nextId<AgentId>(),
      service: () => nextId<ServiceId>(),
      lease: () => nextId<WorkLeaseId>(),
    },
  }

  return { ...world, deps }
}
