import type { EntrySnapshot, StoredSenseSummary } from '@server/domain/catalog-view'
import { isCurated } from '@server/domain/curation'
import { type Fact, type FactOf, isKind } from '@server/domain/fact'
import { factKinds, type Link, meaningKeyOf } from '@server/domain/fact-kinds'
import { canApply, factTransitions, isLive } from '@server/domain/fact-lifecycle'
import type { FeedbackRecord } from '@server/domain/feedback'
import { levelOfRank, openItemStatus } from '@server/domain/monitor'
import type { EntryNode, SenseNode } from '@server/domain/nodes'
import { type PublicViewRecord, STEM_ROLES } from '@server/domain/public-view'
import { levelRank } from '@server/domain/reference'
import { EXACT_LEMMA_TIER, fieldTier, LEMMA_PREFIX_TIER, SEARCH_TIERS } from '@server/domain/search'
import { isMultiword, type Lemma } from '@server/domain/term'
import type { TopicNode } from '@server/domain/topics'
import { MAX_ATTEMPTS, type WorkItem, type WorkLease } from '@server/domain/work'
import type { Deps } from '@server/usecases/deps'
import { ConflictError } from '@server/usecases/errors'
import type {
  AgentRecord,
  JevAnswers,
  LlmJudgement,
  NodeRepo,
  ReviewJob,
  StaleWork,
  StoredMember,
  ViewLookup,
  WithEntry,
  WorkScores,
} from '@server/usecases/ports'
import type { AgentId } from '@shared/agents'
import type { EntryId, FactId, FactKind, Pos, SenseId, TopicId } from '@shared/facts'
import type { FeedbackId } from '@shared/feedback'
import type { CefrLevel, LemmaReference, ReferenceSource } from '@shared/reference'
import type { WorkItemId, WorkLeaseId } from '@shared/work'

// In-memory stand-ins for every port, shared by the use-case tests. They model
// the persistence guarantees the real repos give (live uniqueness, conditional
// writes, compare-and-set) so tests exercise the use cases, not the fakes.

export interface FakeWorld {
  deps: Deps
  entries: EntryNode[]
  senses: SenseNode[]
  facts: Fact[]
  /** A slice of the seeded taxonomy: two categories and some of their leaf topics. */
  topics: TopicNode[]
  feedback: FeedbackRecord[]
  agents: Array<AgentRecord & { keyHash: string }>
  leases: WorkLease[]
  /** The work items, as the work_items table stores them. */
  items: WorkItem[]
  seeds: Set<EntryId>
  /** Each entry's worklist scores, as the worklist table stores them. */
  work: Map<
    EntryId,
    WorkScores & { revision: number; scoredRevision: number; viewRevision: number; lastWorkedAt: string | null }
  >
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
  jevCalls: Array<{ questions: Record<string, string>; state: Record<string, unknown> }>
  llmCalls: Array<{ system: string; user: string }>
  setNow(iso: string): void
  answerJev(answer: (questions: Record<string, string>) => JevAnswers | Promise<JevAnswers>): void
  answerLlm(answer: () => LlmJudgement | Promise<LlmJudgement>): void
  /** Every reviewer of every chain fails what it is asked. */
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

export function fakeWorld(): FakeWorld {
  let now = new Date('2026-01-01T00:00:00.000Z')
  let counter = 0
  const nextId = <T extends string>() => {
    counter += 1
    return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}` as T
  }
  const passingJev = (questions: Record<string, string>): JevAnswers => ({
    model: 'jev-test',
    answers: Object.fromEntries(Object.keys(questions).map((key) => [key, 0.95])),
  })
  const passingLlm = (): LlmJudgement => ({
    model: 'llm-test',
    verdict: 'pass',
    confidence: 0.9,
    reason: 'Looks right.',
  })
  let jevAnswer: (questions: Record<string, string>) => JevAnswers | Promise<JevAnswers> = passingJev
  let llmAnswer: () => LlmJudgement | Promise<LlmJudgement> = passingLlm

  const world: Omit<FakeWorld, 'deps'> = {
    entries: [],
    senses: [],
    facts: [],
    topics: [...fakeTopics],
    feedback: [],
    references: new Map(),
    referenceSources: [],
    agents: [],
    leases: [],
    items: [],
    seeds: new Set(),
    work: new Map(),
    views: new Map(),
    queued: [],
    limitedClients: new Set(),
    cachedResponses: new Map(),
    jevCalls: [],
    llmCalls: [],
    setNow: (iso) => {
      now = new Date(iso)
    },
    answerJev: (answer) => {
      jevAnswer = answer
    },
    answerLlm: (answer) => {
      llmAnswer = answer
    },
    failReviews: () => {
      jevAnswer = (questions) => ({
        model: 'jev-test',
        answers: Object.fromEntries(Object.keys(questions).map((key) => [key, 0.05])),
      })
      llmAnswer = () => ({ model: 'llm-test', verdict: 'fail', confidence: 0.9, reason: 'Wrong.' })
    },
    passReviews: () => {
      jevAnswer = passingJev
      llmAnswer = passingLlm
    },
  }

  const lemmaOf = (entryId: EntryId) => world.entries.find((entry) => entry.id === entryId)?.lemma
  const withLemma = (sense: SenseNode) => ({ ...sense, lemma: lemmaOf(sense.entryId) ?? ('' as never) })
  const live = (fact: Fact) => isLive(fact.status)
  /** The rejected facts among these whose content no live fact holds again, most recently rejected first. */
  const latestRejected = <F extends Fact>(candidates: F[], limit: number) =>
    candidates
      .filter((fact) => fact.status === 'rejected')
      .filter(
        (fact) =>
          !world.facts.some(
            (other) =>
              live(other) &&
              other.kind === fact.kind &&
              other.subjectId === fact.subjectId &&
              other.contentKey === fact.contentKey,
          ),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      .slice(0, limit)
  /** The learner priority of the entry's lemma, as the worklist row stores it. */
  const priorityOf = (entry: EntryNode) => {
    const reference = world.references.get(entry.lemma)
    const levels = reference?.cefr.map((cefr) => levelRank(cefr.level)) ?? []
    return { levelRank: levels.length > 0 ? Math.min(...levels) : null, zipf: reference?.frequency?.zipf ?? null }
  }
  /** The worklist level rank of the entry a fact's subject is or belongs to. */
  const levelOfSubject = (subjectId: string) => {
    const entryId = world.senses.find((sense) => sense.id === subjectId)?.entryId ?? subjectId
    const entry = world.entries.find((candidate) => candidate.id === entryId)
    return entry ? priorityOf(entry).levelRank : null
  }
  /** The entry's open items by where they stand, as the entry list counts them. */
  const openWorkOf = (items: readonly WorkItem[], now: string) => {
    const counts = { total: items.length, in_progress: 0, waiting_on_review: 0, stuck: 0 }
    for (const item of items) {
      const status = openItemStatus({ ...item, leased: item.lease !== null && item.lease.expiresAt > now })
      if (status !== 'queued') counts[status] += 1
    }
    return counts
  }
  /** The entry a node is or belongs to. */
  const entryOfNode = (nodeId: string) => {
    const entryId = world.senses.find((sense) => sense.id === nodeId)?.entryId ?? nodeId
    return world.entries.find((candidate) => candidate.id === entryId)
  }
  /** The lemma of the entry a fact's subject is or belongs to. */
  const lemmaOfSubject = (subjectId: string) => entryOfNode(subjectId)?.lemma
  const withEntry = <T>(record: T, nodeId: string): WithEntry<T> => {
    const entry = entryOfNode(nodeId)
    if (!entry) throw new Error(`Node ${nodeId} belongs to no entry.`)
    return { ...record, entry: { id: entry.id, lemma: entry.lemma } }
  }
  const factWithEntry = (fact: Fact) => withEntry(fact, fact.subjectId)
  const feedbackWithEntry = (item: FeedbackRecord) => {
    const fact = item.targetType === 'fact' ? world.facts.find((candidate) => candidate.id === item.targetId) : null
    return withEntry(item, fact?.subjectId ?? item.targetId)
  }
  /** Published on an uncertain or failed review, as the facts list `weak` filter selects. */
  const isWeak = (fact: Fact) =>
    fact.status === 'published' && ['uncertain', 'fail'].includes(fact.review?.verdict ?? '')
  const liveEntry = (entryId: string) =>
    world.facts.some((fact) => fact.kind === 'entry' && fact.subjectId === entryId && live(fact))
  /** A sense of the entry that is a verb with a live gloss. */
  const hasLiveVerb = (entryId: string) =>
    world.senses.some(
      (sense) =>
        sense.entryId === entryId &&
        sense.pos === 'verb' &&
        world.facts.some((fact) => fact.kind === 'sense' && fact.subjectId === sense.id && live(fact)),
    )
  /** The live multiword entries headed by this lemma, its first word, with a live verb sense. */
  const phrasesOf = (lemma: string) =>
    isMultiword(lemma)
      ? []
      : world.entries
          .filter(
            (other) =>
              isMultiword(other.lemma) &&
              other.lemma.split(' ')[0] === lemma &&
              liveEntry(other.id) &&
              hasLiveVerb(other.id),
          )
          .map((other) => other.lemma)
          .sort()
  /** The other live entries with a live morphology fact naming this lemma as a base. */
  const familyOf = (entry: EntryNode) =>
    [
      ...new Set(
        world.facts
          .filter(isKind('morphology'))
          .filter(
            (fact) =>
              live(fact) &&
              fact.subjectId !== entry.id &&
              liveEntry(fact.subjectId) &&
              fact.payload.parts.some((part) => part.role === 'base' && part.lemma === entry.lemma),
          )
          .flatMap((fact) => lemmaOf(fact.subjectId as EntryId) ?? []),
      ),
    ].sort()
  const workOf = (entryId: EntryId) => {
    const row = world.work.get(entryId) ?? {
      completeness: 0,
      quality: 1,
      slots: { total: 0, published: 0, pending: 0 },
      revision: 0,
      scoredRevision: 0,
      viewRevision: 0,
      lastWorkedAt: null,
    }
    world.work.set(entryId, row)
    return row
  }
  /** Marks stale the entries that are, or own as a sense, these nodes, as the real batches do. */
  const touch = (nodeIds: Array<string | null>) => {
    const owners = new Set<EntryId>()
    for (const entry of world.entries.filter((candidate) => nodeIds.includes(candidate.id))) owners.add(entry.id)
    for (const sense of world.senses.filter((candidate) => nodeIds.includes(candidate.id))) owners.add(sense.entryId)
    for (const entryId of owners) workOf(entryId).revision += 1
  }
  /** The entries whose relations link to a sense that is, or belongs to, one of these nodes, and the words of a phrase among them. */
  const linkedEntries = (nodeIds: Array<string | null>) => {
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
    const phraseHeads = world.entries
      .filter(
        (entry) =>
          isMultiword(entry.lemma) &&
          (nodeIds.includes(entry.id) ||
            world.senses.some((sense) => sense.entryId === entry.id && nodeIds.includes(sense.id))),
      )
      .map((entry) => entry.lemma.split(' ')[0])
    return new Set([
      ...world.senses.filter((sense) => ends.includes(sense.id)).map((sense) => sense.entryId),
      ...world.entries.filter((entry) => phraseHeads.includes(entry.lemma)).map((entry) => entry.id),
    ])
  }
  /** The entries a morphology fact, or the morphology of the entry an entry fact defines, names as a base. */
  const familyBases = (fact: Fact) => {
    const named = world.facts
      .filter(isKind('morphology'))
      .filter(
        (candidate) => candidate.id === fact.id || (fact.kind === 'entry' && candidate.subjectId === fact.subjectId),
      )
      .flatMap((candidate) =>
        candidate.payload.parts.flatMap((part) => (part.role === 'base' && part.lemma ? [part.lemma] : [])),
      )
    return world.entries.filter((entry) => named.includes(entry.lemma)).map((entry) => entry.id)
  }
  /** Marks stale the entries linked to the node an entry or sense fact defines, and the bases a morphology names, as the real batches do. */
  const touchLinked = (fact: Fact) => {
    for (const entryId of familyBases(fact)) workOf(entryId).revision += 1
    if (fact.kind !== 'entry' && fact.kind !== 'sense') return
    for (const entryId of linkedEntries([fact.subjectId])) workOf(entryId).revision += 1
  }
  const definedLive = (kind: 'entry' | 'sense', nodeId: string) =>
    world.facts.some((fact) => fact.kind === kind && fact.subjectId === nodeId && live(fact))
  /** Retracts the live links at a sense the written entry or sense fact defines that can no longer show, as the real batch does. */
  const retireDeadLinks = (written: Fact, at: string) => {
    if (written.kind !== 'entry' && written.kind !== 'sense') return
    const dead = new Set<string>(
      world.senses
        .filter((sense) => sense.id === written.subjectId || sense.entryId === written.subjectId)
        .filter((sense) => !definedLive('sense', sense.id) || !definedLive('entry', sense.entryId))
        .map((sense) => sense.id),
    )
    world.facts.forEach((fact, index) => {
      if (fact.objectId === null || !canApply('retract', fact.status)) return
      if (!dead.has(fact.subjectId) && !dead.has(fact.objectId)) return
      world.facts[index] = { ...fact, status: factTransitions.retract.to, updatedAt: at, revalidateSince: null } as Fact
    })
  }
  const touchFact = (factId: string) => {
    const fact = world.facts.find((candidate) => candidate.id === factId)
    if (fact) touch([fact.subjectId, fact.objectId])
  }
  const staleOf = (entryId: EntryId): StaleWork => ({ entryId, revision: workOf(entryId).revision })
  /** In the production queue, and free at `now`. */
  const claimable = (item: WorkItem, now: string) =>
    !item.awaiting && item.attempts < MAX_ATTEMPTS && (item.lease === null || item.lease.expiresAt <= now)
  const queueOrder = (a: WorkItem, b: WorkItem) =>
    a.rank - b.rank || b.zipfOrder - a.zipfOrder || a.id.localeCompare(b.id)
  let itemCount = 0
  const isStale = (entryId: EntryId) => workOf(entryId).revision !== workOf(entryId).scoredRevision
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

  /** Built views in lemma order, as the view's lemma index reads them. */
  const builtViews = () => [...world.views.values()].sort((a, b) => a.document.lemma.localeCompare(b.document.lemma))
  const isViewStale = (entryId: EntryId) => workOf(entryId).revision !== workOf(entryId).viewRevision
  const viewLookup = (entryId: EntryId): ViewLookup => {
    const record = world.views.get(entryId)
    const json = record && JSON.stringify(record.document)
    return {
      stale: isViewStale(entryId) ? { entryId, revision: workOf(entryId).revision } : null,
      view: json ? { json, digest: fakeDigest(json) } : null,
    }
  }

  const creationKeys = new Map<string, string>()
  const nodes: NodeRepo = {
    findEntryByLemma: async (lemma) => world.entries.find((entry) => entry.lemma === lemma) ?? null,
    findEntry: async (id) => world.entries.find((entry) => entry.id === id) ?? null,
    insertEntry: async (entry) => {
      const existing = world.entries.find((candidate) => candidate.lemma === entry.lemma)
      if (existing) return existing
      world.entries.push(entry)
      workOf(entry.id)
      return entry
    },
    findSense: async (id) => {
      const sense = world.senses.find((candidate) => candidate.id === id)
      return sense ? withLemma(sense) : null
    },
    findSenseByGloss: async (entryId, pos, meaningKey) => {
      for (const sense of world.senses.filter((s) => s.entryId === entryId && s.pos === pos)) {
        const fact = world.facts.find(
          (candidate) =>
            candidate.kind === 'sense' &&
            candidate.subjectId === sense.id &&
            live(candidate) &&
            meaningKeyOf('sense', candidate.payload as FactOf<'sense'>['payload']) === meaningKey,
        )
        if (fact) return { sense, fact }
      }
      return null
    },
    listLiveGlosses: async (entryId) =>
      world.senses
        .filter((sense) => sense.entryId === entryId)
        .flatMap((sense) =>
          world.facts
            .filter(
              (fact): fact is FactOf<'sense'> => fact.kind === 'sense' && fact.subjectId === sense.id && live(fact),
            )
            .map((fact) => ({ sense, fact })),
        ),
    insertSenseWithFact: async (sense, fact, creationKey) => {
      const existing = world.senses.find(
        (candidate) =>
          candidate.entryId === sense.entryId &&
          candidate.pos === sense.pos &&
          creationKeys.get(candidate.id) === creationKey,
      )
      if (existing) {
        const defining = world.facts.find(
          (candidate) => candidate.kind === 'sense' && candidate.subjectId === existing.id,
        )
        if (!defining) throw new Error(`Sense ${existing.id} has no defining fact.`)
        return { sense: existing, fact: defining }
      }
      world.senses.push(sense)
      creationKeys.set(sense.id, creationKey)
      world.facts.push(fact)
      touch([sense.entryId])
      touchLinked(fact)
      return { sense, fact }
    },
    loadEntrySnapshot: async (entry): Promise<EntrySnapshot> => {
      const own = world.senses.filter((sense) => sense.entryId === entry.id)
      const ownIds = new Set<string>(own.map((sense) => sense.id))
      const facts = world.facts.filter((fact) => fact.subjectId === entry.id || ownIds.has(fact.subjectId))
      const incoming = world.facts.filter((fact) => fact.kind === 'relation' && ownIds.has(fact.objectId ?? ''))
      const neighborIds = new Set<string>([
        ...facts.filter((fact) => fact.kind === 'relation').map((fact) => fact.objectId ?? ''),
        ...incoming.map((fact) => fact.subjectId),
      ])
      const neighbors = world.senses.filter((sense) => neighborIds.has(sense.id))
      const neighborEntries = new Set<string>(neighbors.map((sense) => sense.entryId))
      return {
        entry,
        seed: world.seeds.has(entry.id),
        levelRank: priorityOf(entry).levelRank,
        zipf: priorityOf(entry).zipf,
        coreVerb:
          world.references.get(entry.lemma)?.cefr.some((cefr) => cefr.pos === 'verb' && levelRank(cefr.level) <= 2) ??
          false,
        phrases: phrasesOf(entry.lemma),
        family: familyOf(entry),
        senses: own.map(withLemma),
        facts,
        incoming,
        flagged: new Set(
          world.feedback
            .filter((item) => item.targetType === 'fact' && (item.status === 'open' || item.status === 'claimed'))
            .map((item) => item.targetId as FactId)
            .filter((targetId) => facts.some((fact) => fact.id === targetId)),
        ),
        neighbors: {
          senses: neighbors.map(withLemma),
          facts: world.facts.filter(
            (fact) =>
              (fact.kind === 'sense' && neighborIds.has(fact.subjectId)) ||
              (fact.kind === 'entry' && neighborEntries.has(fact.subjectId)),
          ),
        },
      }
    },
    listEntrySummaries: async ({ prefix, level, flagged, stuck }, page, now) => {
      const ownFacts = (entry: EntryNode) => {
        const own = new Set<string>(world.senses.filter((sense) => sense.entryId === entry.id).map(({ id }) => id))
        return world.facts.filter((fact) => fact.subjectId === entry.id || own.has(fact.subjectId))
      }
      const itemsOf = (entry: EntryNode) => world.items.filter((item) => item.entryId === entry.id)
      const summaries = world.entries
        .filter((entry) => entry.lemma.startsWith(prefix))
        .filter((entry) => !level || priorityOf(entry).levelRank === levelRank(level))
        .filter((entry) => !flagged || ownFacts(entry).some(isWeak))
        .filter((entry) => !stuck || itemsOf(entry).some((item) => item.attempts >= MAX_ATTEMPTS))
        .sort((a, b) => a.lemma.localeCompare(b.lemma))
        .map((entry) => {
          const facts = ownFacts(entry)
          const [entryFact] = facts
            .filter((fact) => fact.kind === 'entry')
            .sort((a, b) => Number(live(b)) - Number(live(a)) || b.updatedAt.localeCompare(a.updatedAt))
          const glossed = new Set(facts.filter((fact) => fact.kind === 'sense' && live(fact)).map((f) => f.subjectId))
          const statusCount = (status: Fact['status']) => facts.filter((fact) => fact.status === status).length
          return {
            id: entry.id,
            lemma: entry.lemma,
            entry_status: entryFact?.status ?? null,
            sense_count: glossed.size,
            fact_counts: {
              pending: statusCount('pending'),
              published: statusCount('published'),
              rejected: statusCount('rejected'),
              superseded: statusCount('superseded'),
              retracted: statusCount('retracted'),
            },
            last_worked_at: world.work.get(entry.id)?.lastWorkedAt ?? null,
            created_at: entry.createdAt,
            level: levelOfRank(priorityOf(entry).levelRank),
            completeness: workOf(entry.id).completeness,
            quality: workOf(entry.id).quality,
            slots: workOf(entry.id).slots,
            open_work: openWorkOf(itemsOf(entry), now),
          }
        })
      return paged(summaries, page.limit, page.cursor)
    },
    findLiveForms: async (contentKeys) =>
      world.facts
        .filter((fact): fact is FactOf<'form'> => fact.kind === 'form' && live(fact))
        .filter((fact) => contentKeys.some((key) => fact.contentKey === key || fact.contentKey.startsWith(`${key}|`)))
        .flatMap((fact) => {
          const entry = world.entries.find((candidate) => candidate.id === fact.subjectId)
          const entryLive = world.facts.some((f) => f.kind === 'entry' && f.subjectId === fact.subjectId && live(f))
          return entry && entryLive ? [{ entry, fact }] : []
        }),
    listLiveCaseVariants: async ({ id, lemma }) =>
      world.entries
        .filter((entry) => entry.id !== id && entry.lemma.toLowerCase() === lemma.toLowerCase())
        .filter((entry) => world.facts.some((f) => f.kind === 'entry' && f.subjectId === entry.id && live(f)))
        .map((entry) => entry.lemma)
        .sort(),
  }

  const deps: Deps = {
    nodes,
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
      listLive: async (kind, subjectId) =>
        world.facts.filter((fact) => fact.kind === kind && fact.subjectId === subjectId && live(fact)),
      insert: async (fact) => {
        const existing = findLive(fact.kind, fact.subjectId, fact.contentKey)
        if (existing) return existing
        if (violatedIndex(world.facts, fact)) return null
        const { maxLive } = factKinds[fact.kind]
        if (maxLive !== undefined && heldLive(fact, fact.supersedesId) >= maxLive) return null
        if (fact.supersedesId && !isPublished(fact.supersedesId)) return null
        world.facts.push(fact)
        touch([fact.subjectId, fact.objectId])
        touchLinked(fact)
        return fact
      },
      listLiveLinks: async <K extends FactKind>(kind: K, between: readonly [EntryId, EntryId]) => {
        const entryOf = (id: string | null) => world.senses.find((sense) => sense.id === id)?.entryId
        return world.facts.flatMap((fact): Link<K>[] => {
          const subject = entryOf(fact.subjectId)
          const target = entryOf(fact.objectId)
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
        })
      },
      findLiveCorrection: async (id) => world.facts.find((fact) => fact.supersedesId === id && live(fact)) ?? null,
      transition: async ({
        id,
        from,
        to,
        at,
        review,
        supersede,
        revalidate,
        revalidateSince,
        liveBelow,
        unsuperseded,
        originalPublished,
        rereview,
      }) => {
        const fact = world.facts.find((candidate) => candidate.id === id)
        if (!fact || !from.includes(fact.status)) return false
        if (revalidateSince !== undefined && fact.revalidateSince !== revalidateSince) return false
        if (liveBelow && heldLive(fact, liveBelow.excluding) >= liveBelow.max) return false
        if (unsuperseded && world.facts.some((candidate) => candidate.supersedesId === id && live(candidate))) {
          return false
        }
        if (originalPublished && !isPublished(originalPublished)) return false
        const next = {
          ...fact,
          status: to,
          updatedAt: at,
          review: review ?? fact.review,
          revalidateSince: null,
        } as Fact
        const dependsOnNode = (candidate: Fact) =>
          revalidate !== undefined &&
          live(candidate) &&
          !isCurated(candidate) &&
          revalidate.kinds.includes(candidate.kind) &&
          (candidate.subjectId === revalidate.nodeId || candidate.objectId === revalidate.nodeId)
        const rereviewed = (candidate: Fact) =>
          rereview !== undefined &&
          candidate.kind === rereview.kind &&
          candidate.status === 'published' &&
          candidate.revalidateSince === null &&
          candidate.review?.reviewer === rereview.settledBy &&
          candidate.subjectId !== fact.subjectId &&
          world.entries.some((entry) => entry.id === candidate.subjectId && entry.lemma === rereview.lemma)
        const retired = world.facts.map((candidate): Fact => {
          if (candidate.id === supersede && candidate.status === 'published') {
            return { ...candidate, status: 'superseded', updatedAt: at, revalidateSince: null }
          }
          return dependsOnNode(candidate) || rereviewed(candidate) ? { ...candidate, revalidateSince: at } : candidate
        })
        const violation = violatedIndex(retired, next)
        if (violation) throw new ConflictError(violation)
        world.facts.splice(
          0,
          world.facts.length,
          ...retired.map((candidate) => (candidate.id === id ? next : candidate)),
        )
        retireDeadLinks(next, at)
        touch([next.subjectId, next.objectId])
        touchLinked(next)
        return true
      },
      listRejected: async (nodeId, kinds, limit) =>
        latestRejected(
          world.facts
            .filter((fact) => kinds.includes(fact.kind))
            .filter((fact) => fact.subjectId === nodeId || fact.objectId === nodeId),
          limit,
        ),
      listRejectedDerivations: async (baseLemma, limit) =>
        latestRejected(
          world.facts
            .filter(isKind('morphology'))
            .filter((fact) => fact.payload.parts.some((part) => part.role === 'base' && part.lemma === baseLemma)),
          limit,
        ).map((fact) => {
          const word = lemmaOf(fact.subjectId as EntryId)
          if (word === undefined) throw new Error(`Word formation ${fact.id} is about no entry.`)
          return { word, fact }
        }),
      listRevalidating: async (nodeId) =>
        world.facts
          .filter((fact) => live(fact) && fact.revalidateSince !== null)
          .filter((fact) => fact.subjectId === nodeId || fact.objectId === nodeId)
          .map((fact) => fact.id),
      listStuckBefore: async (cutoff, limit) =>
        [
          ...world.facts.filter((fact) => fact.status === 'pending' && fact.updatedAt < cutoff),
          ...world.facts.filter(
            (fact) => fact.status === 'published' && fact.revalidateSince !== null && fact.revalidateSince < cutoff,
          ),
        ]
          .slice(0, limit)
          .map((fact) => fact.id),
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
      list: async ({ status, kind, author, lemma, weak, level }, page) =>
        paged(
          world.facts
            .filter(
              (fact) =>
                (!status || fact.status === status) &&
                (!kind || fact.kind === kind) &&
                (!author || fact.author === author) &&
                (!lemma || lemmaOfSubject(fact.subjectId) === lemma) &&
                (!weak || isWeak(fact)) &&
                (!level || levelOfSubject(fact.subjectId) === levelRank(level)),
            )
            .map(factWithEntry),
          page.limit,
          page.cursor,
        ),
      countByKindAndStatus: async () => {
        const counts = new Map<string, { kind: Fact['kind']; status: Fact['status']; count: number }>()
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
    },
    feedback: {
      insert: async (item) => {
        world.feedback.push(item)
        touchFact(item.targetId)
      },
      find: async (id) => world.feedback.find((item) => item.id === id) ?? null,
      update: async (next, expectedRevision) => {
        const index = world.feedback.findIndex((item) => item.id === next.id)
        if (world.feedback[index]?.revision !== expectedRevision) return false
        world.feedback[index] = next
        touchFact(next.targetId)
        return true
      },
      findWithEntry: async (id) => {
        const item = world.feedback.find((candidate) => candidate.id === id)
        return item ? feedbackWithEntry(item) : null
      },
      list: async ({ status }, page) =>
        paged(
          world.feedback.filter((item) => !status || item.status === status).map(feedbackWithEntry),
          page.limit,
          page.cursor,
        ),
      countByStatus: async () => {
        const counts = { open: 0, claimed: 0, resolved: 0, dismissed: 0 }
        for (const item of world.feedback) counts[item.status] += 1
        return counts
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
    work: {
      markSeed: async (entryId) => {
        world.seeds.add(entryId)
      },
      listStale: async (nodeIds) => {
        const owners = new Set<EntryId>([
          ...world.entries.filter((entry) => nodeIds.includes(entry.id)).map((entry) => entry.id),
          ...world.senses.filter((sense) => nodeIds.includes(sense.id)).map((sense) => sense.entryId),
          ...linkedEntries(nodeIds),
          ...world.facts
            .filter((fact) => fact.kind === 'morphology' && nodeIds.includes(fact.subjectId))
            .flatMap(familyBases),
        ])
        return [...owners].filter(isStale).map(staleOf)
      },
      listAnyStale: async (limit) => [...world.work.keys()].filter(isStale).slice(0, limit).map(staleOf),
      countStale: async () => [...world.work.keys()].filter(isStale).length,
      listItems: async (entryId) => world.items.filter((item) => item.entryId === entryId).map((item) => ({ ...item })),
      findItems: async (ids) => world.items.filter((item) => ids.includes(item.id)).map((item) => ({ ...item })),
      saveAssessment: async (stale, scores, { writes, deletes }) => {
        const row = workOf(stale.entryId)
        if (row.revision !== stale.revision) return
        Object.assign(row, scores, { scoredRevision: stale.revision })
        const kept = world.items.filter((item) => !deletes.includes(item.id))
        for (const write of writes) {
          const { id, ...values } = write
          const stored = kept.find((item) => item.type === write.type && item.subjectId === write.subjectId)
          if (stored) Object.assign(stored, values)
          else {
            itemCount += 1
            kept.push({
              ...values,
              id: id ?? (`00000000-0000-4000-9000-${String(itemCount).padStart(12, '0')}` as WorkItemId),
              entryId: stale.entryId,
              claimedGap: null,
              lease: null,
              lastWorkedAt: null,
              lastWorkedBy: null,
              lastNote: null,
            })
          }
        }
        world.items.splice(0, world.items.length, ...kept)
      },
      claim: async (draft, types, limit, now) => {
        const queue = world.items.filter((item) => claimable(item, now)).sort(queueOrder)
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
          claimedAt: now,
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
        for (const item of world.items.filter((candidate) => candidate.lease?.id === lease.id)) {
          const pass = worked.find((candidate) => candidate.id === item.id)
          if (pass)
            Object.assign(item, {
              worked: true,
              lastWorkedAt: at,
              lastWorkedBy: lease.holder,
              lastNote: pass.note ?? null,
            })
          item.lease = null
        }
        for (const entryId of lease.entryIds) {
          workOf(entryId).revision += 1
          workOf(entryId).lastWorkedAt = at
        }
        return true
      },
      listCuration: async (type, request) =>
        paged(
          world.items
            .filter((item) => item.attempts >= MAX_ATTEMPTS && (type === null || item.type === type))
            .sort(queueOrder)
            .map((item) => ({ ...item, lemma: lemmaOf(item.entryId) ?? ('' as Lemma) })),
          request.limit,
          request.cursor,
        ),
      purgeLeases: async (before) => {
        const expired = world.leases.filter((lease) => lease.expiresAt <= before)
        world.leases.splice(0, world.leases.length, ...world.leases.filter((lease) => lease.expiresAt > before))
        return expired.length
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
            phrases: built
              .filter(([, record]) => record.phraseWords.includes(lemma))
              .map(([, r]) => r.document.summary),
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
        const sense = world.senses.find((candidate) => candidate.id === id)
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
      listEntries: async ({ prefix, levels, pos, leaves }, sort, page) => {
        const fits = (candidate: { pos: Pos; cefr: CefrLevel | null }) =>
          (pos === null || candidate.pos === pos) &&
          (levels.length === 0 || (candidate.cefr !== null && levels.includes(candidate.cefr)))
        const admitted = builtViews().filter(
          (record) =>
            record.document.lemma.startsWith(prefix) &&
            (leaves
              ? record.taggedSenses.some((tag) => leaves.includes(tag.topicId) && !tag.rare && fits(tag.summary))
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
      listTaggedSenses: async (leaves, sort, page) => {
        const tagged = new Map<string, { summary: StoredSenseSummary; order: number }>()
        for (const record of builtViews()) {
          for (const tag of record.taggedSenses.filter((candidate) => leaves.includes(candidate.topicId))) {
            const order = { lemma: 0, frequency: record.frequencyOrder, level: tag.levelOrder }[sort]
            tagged.set(tag.summary.sense_id, { summary: tag.summary, order })
          }
        }
        const ordered = [...tagged.values()].sort(
          (a, b) =>
            a.order - b.order ||
            a.summary.lemma.localeCompare(b.summary.lemma) ||
            a.summary.sense_id.localeCompare(b.summary.sense_id),
        )
        return paged(
          ordered.map((tag) => tag.summary),
          page.limit,
          page.cursor,
        )
      },
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
          for (const link of next) nearest.set(link.summary.sense_id, { summary: link.summary, depth })
          frontier = [...new Set(next.map((link) => link.summary.sense_id))]
        }
        const ordered = [...nearest.values()].sort(
          (a, b) =>
            a.depth - b.depth ||
            a.summary.lemma.localeCompare(b.summary.lemma) ||
            a.summary.sense_id.localeCompare(b.summary.sense_id),
        )
        return paged(ordered, page.limit, page.cursor)
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
      listStale: async (nodeIds) => {
        const owners = new Set<EntryId>([
          ...world.entries.filter((entry) => nodeIds.includes(entry.id)).map((entry) => entry.id),
          ...world.senses.filter((sense) => nodeIds.includes(sense.id)).map((sense) => sense.entryId),
          ...linkedEntries(nodeIds),
        ])
        return [...owners].filter(isViewStale).map((entryId) => ({ entryId, revision: workOf(entryId).revision }))
      },
      listAnyStale: async (limit) =>
        [...world.work.keys()]
          .filter(isViewStale)
          .slice(0, limit)
          .map((entryId) => ({ entryId, revision: workOf(entryId).revision })),
      countStale: async () => [...world.work.keys()].filter(isViewStale).length,
      save: async (stale, record) => {
        const row = workOf(stale.entryId)
        if (row.revision !== stale.revision) return
        if (record) world.views.set(stale.entryId, record)
        else world.views.delete(stale.entryId)
        row.viewRevision = stale.revision
      },
    },
    jev: {
      ask: async (questions, state) => {
        world.jevCalls.push({ questions, state })
        return jevAnswer(questions)
      },
    },
    llm: {
      judge: async (prompt) => {
        world.llmCalls.push(prompt)
        return llmAnswer()
      },
    },
    reviewQueue: {
      enqueue: async (jobs) => {
        world.queued.push(...jobs)
      },
    },
    feedbackLimiter: {
      allow: async (key) => !world.limitedClients.has(key),
    },
    readLimiter: {
      allow: async (key) => !world.limitedClients.has(key),
    },
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
      listCefrListings: async (lemma) =>
        (world.references.get(lemma)?.cefr ?? []).map(({ level, pos, source_id }) => {
          const source = world.referenceSources.find((candidate) => candidate.id === source_id)
          if (!source) throw new Error(`CEFR row of ${lemma} names the unknown source ${source_id}.`)
          return { level, pos, source: source.name }
        }),
      listSources: async () => world.referenceSources,
      listCefrLemmasWithoutEntry: async () => {
        const lowest = new Map<string, string>()
        for (const [lemma, reference] of world.references) {
          const levels = reference.cefr.map((cefr) => cefr.level).sort()
          if (levels.length > 0 && !world.entries.some((entry) => entry.lemma === lemma)) lowest.set(lemma, levels[0])
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
      fact: () => nextId<FactId>(),
      feedback: () => nextId<FeedbackId>(),
      agent: () => nextId<AgentId>(),
      lease: () => nextId<WorkLeaseId>(),
    },
  }

  return { ...world, deps } as FakeWorld
}
