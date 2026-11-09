import type { EntrySnapshot } from '@server/domain/catalog-view'
import type { Fact, FactOf } from '@server/domain/fact'
import { factKinds } from '@server/domain/fact-kinds'
import { isLive } from '@server/domain/fact-lifecycle'
import type { FeedbackRecord } from '@server/domain/feedback'
import type { EntryNode, SenseNode } from '@server/domain/nodes'
import type { TopicNode } from '@server/domain/topics'
import { claimTier, isClaimable, type WorkLease } from '@server/domain/work'
import type { Deps } from '@server/usecases/deps'
import { ConflictError } from '@server/usecases/errors'
import type {
  AgentRecord,
  JevAnswers,
  LlmJudgement,
  NodeRepo,
  ReviewJob,
  StaleWork,
  WorkScores,
} from '@server/usecases/ports'
import type { AgentId } from '@shared/agents'
import type { EntryId, FactId, SenseId, TopicId } from '@shared/facts'
import type { FeedbackId } from '@shared/feedback'
import type { WorkLeaseId } from '@shared/work'

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
  /** When each entry was last claimed. */
  claimed: Map<EntryId, string>
  seeds: Set<EntryId>
  /** Each entry's worklist scores, as the worklist table stores them. */
  work: Map<EntryId, WorkScores & { claimedWork: string | null; revision: number; scoredRevision: number }>
  worked: Map<EntryId, { lastWorkedAt: string; lastWorkedBy: string; lastNote: string | null }>
  queued: ReviewJob[]
  /** Client keys the feedback limiter refuses. */
  limitedClients: Set<string>
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
    agents: [],
    leases: [],
    claimed: new Map(),
    seeds: new Set(),
    work: new Map(),
    worked: new Map(),
    queued: [],
    limitedClients: new Set(),
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
  const workOf = (entryId: EntryId) => {
    const row = world.work.get(entryId) ?? {
      completeness: 0,
      quality: 1,
      stalled: false,
      awaitingReview: false,
      claimedWork: null,
      revision: 0,
      scoredRevision: 0,
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
  const touchFact = (factId: string) => {
    const fact = world.facts.find((candidate) => candidate.id === factId)
    if (fact) touch([fact.subjectId, fact.objectId])
  }
  const staleOf = (entryId: EntryId): StaleWork => {
    const claimedAt = world.claimed.get(entryId)
    const workedAt = world.worked.get(entryId)?.lastWorkedAt
    return {
      entryId,
      revision: workOf(entryId).revision,
      lastClaim: {
        openWork: workOf(entryId).claimedWork,
        completed: claimedAt !== undefined && workedAt !== undefined && workedAt >= claimedAt,
      },
    }
  }
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
  // The D1 partial unique indexes: live content, and an exclusive slot's holder and pending fact.
  const holdsSlot = (fact: Fact) =>
    fact.status === 'published' || (fact.status === 'pending' && fact.supersedesId === null)
  const violatesIndexes = (facts: Fact[], candidate: Fact) =>
    facts.some((other) => {
      if (other.id === candidate.id || other.kind !== candidate.kind || other.subjectId !== candidate.subjectId) {
        return false
      }
      if (live(other) && live(candidate) && other.contentKey === candidate.contentKey) return true
      if (factKinds[candidate.kind].cardinality === 'many') return false
      return (
        (holdsSlot(other) && holdsSlot(candidate)) || (other.status === 'pending' && candidate.status === 'pending')
      )
    })
  const paged = <T>(items: T[], limit: number, cursor: string | undefined) => {
    const start = cursor ? Number(cursor) : 0
    const slice = items.slice(start, start + limit)
    return { items: slice, nextCursor: start + limit < items.length ? String(start + limit) : null }
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
    findSenseByGloss: async (entryId, pos, contentKeys) => {
      for (const sense of world.senses.filter((s) => s.entryId === entryId && s.pos === pos)) {
        for (const contentKey of contentKeys) {
          const fact = findLive('sense', sense.id, contentKey)
          if (fact) return { sense, fact }
        }
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
    searchPublishedEntries: async (prefix, page) => {
      const published = world.entries
        .filter((entry) => entry.lemma.startsWith(prefix))
        .filter((entry) =>
          world.facts.some((f) => f.kind === 'entry' && f.subjectId === entry.id && f.status === 'published'),
        )
        .sort((a, b) => a.lemma.localeCompare(b.lemma))
        .map((entry) => ({ id: entry.id, lemma: entry.lemma }))
      return paged(published, page.limit, page.cursor)
    },
    listEntrySummaries: async (prefix, page) => {
      const summaries = world.entries
        .filter((entry) => entry.lemma.startsWith(prefix))
        .sort((a, b) => a.lemma.localeCompare(b.lemma))
        .map((entry) => {
          const own = new Set<string>(world.senses.filter((sense) => sense.entryId === entry.id).map(({ id }) => id))
          const facts = world.facts.filter((fact) => fact.subjectId === entry.id || own.has(fact.subjectId))
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
            last_worked_at: world.worked.get(entry.id)?.lastWorkedAt ?? null,
            created_at: entry.createdAt,
          }
        })
      return paged(summaries, page.limit, page.cursor)
    },
    findPublishedForms: async (contentKeys) =>
      world.facts
        .filter((fact): fact is FactOf<'form'> => fact.kind === 'form' && fact.status === 'published')
        .filter((fact) => contentKeys.includes(fact.contentKey))
        .flatMap((fact) => {
          const entry = world.entries.find((candidate) => candidate.id === fact.subjectId)
          return entry ? [{ entry, fact }] : []
        }),
  }

  const deps: Deps = {
    nodes,
    facts: {
      find: async (id) => world.facts.find((fact) => fact.id === id) ?? null,
      findLive: async (kind, subjectId, contentKey) => findLive(kind, subjectId, contentKey),
      insert: async (fact) => {
        const existing = findLive(fact.kind, fact.subjectId, fact.contentKey)
        if (existing) return existing
        if (violatesIndexes(world.facts, fact)) return null
        const { maxLive } = factKinds[fact.kind]
        if (maxLive !== undefined && heldLive(fact, fact.supersedesId) >= maxLive) return null
        world.facts.push(fact)
        touch([fact.subjectId, fact.objectId])
        return fact
      },
      transition: async ({ id, from, to, at, review, supersede, revalidate, revalidateSince, liveBelow }) => {
        const fact = world.facts.find((candidate) => candidate.id === id)
        if (!fact || !from.includes(fact.status)) return false
        if (revalidateSince !== undefined && fact.revalidateSince !== revalidateSince) return false
        if (liveBelow && heldLive(fact, liveBelow.excluding) >= liveBelow.max) return false
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
          revalidate.kinds.includes(candidate.kind) &&
          (candidate.subjectId === revalidate.nodeId || candidate.objectId === revalidate.nodeId)
        const retired = world.facts.map((candidate): Fact => {
          if (candidate.id === supersede && candidate.status === 'published') {
            return { ...candidate, status: 'superseded', updatedAt: at, revalidateSince: null }
          }
          return dependsOnNode(candidate) ? { ...candidate, revalidateSince: at } : candidate
        })
        if (violatesIndexes(retired, next)) throw new ConflictError('Another live fact already holds this slot.')
        world.facts.splice(
          0,
          world.facts.length,
          ...retired.map((candidate) => (candidate.id === id ? next : candidate)),
        )
        touch([next.subjectId, next.objectId])
        return true
      },
      listRevalidating: async (nodeId) =>
        world.facts
          .filter((fact) => live(fact) && fact.revalidateSince !== null)
          .filter((fact) => fact.subjectId === nodeId || fact.objectId === nodeId)
          .map((fact) => fact.id),
      listStuckBefore: async (cutoff, limit) =>
        world.facts
          .filter(
            (fact) =>
              (fact.status === 'pending' && fact.updatedAt < cutoff) ||
              (fact.status === 'published' && fact.revalidateSince !== null && fact.revalidateSince < cutoff),
          )
          .slice(0, limit)
          .map((fact) => fact.id),
      list: async ({ status, kind }, page) =>
        paged(
          world.facts.filter((fact) => (!status || fact.status === status) && (!kind || fact.kind === kind)),
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
      listTaggedSenses: async (leaves, page) => {
        const published = (kind: Fact['kind'], subjectId: string) =>
          world.facts.find((fact) => fact.kind === kind && fact.subjectId === subjectId && fact.status === 'published')
        const tagged = world.senses.flatMap((sense) => {
          const entry = world.entries.find((candidate) => candidate.id === sense.entryId)
          const gloss = published('sense', sense.id) as FactOf<'sense'> | undefined
          const isTagged = world.facts.some(
            (fact) =>
              fact.kind === 'topic' &&
              fact.subjectId === sense.id &&
              fact.status === 'published' &&
              leaves.includes(fact.payload.topic_id),
          )
          if (!entry || !gloss || !isTagged || !published('entry', entry.id)) return []
          return [{ id: sense.id, lemma: entry.lemma, pos: sense.pos, gloss: gloss.payload.gloss }]
        })
        const ordered = tagged.sort((a, b) => a.lemma.localeCompare(b.lemma) || a.id.localeCompare(b.id))
        return paged(ordered, page.limit, page.cursor)
      },
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
      list: async ({ status }, page) =>
        paged(
          world.feedback.filter((item) => !status || item.status === status),
          page.limit,
          page.cursor,
        ),
      countOpen: async () =>
        world.feedback.filter((item) => item.status === 'open' || item.status === 'claimed').length,
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
      claimNext: async (lease, now) => {
        const claimable = (entry: EntryNode) =>
          isClaimable({
            live: world.facts.some((fact) => fact.kind === 'entry' && fact.subjectId === entry.id && live(fact)),
            stale: isStale(entry.id),
            ...workOf(entry.id),
          }) && !world.leases.some((held) => held.entryId === entry.id && held.expiresAt > now)
        const order = (entry: EntryNode) =>
          [
            claimTier({ seed: world.seeds.has(entry.id), claimed: world.claimed.has(entry.id) }),
            world.claimed.get(entry.id) ?? '',
            workOf(entry.id).completeness,
            entry.createdAt,
            entry.id,
          ] as const
        const compare = (a: EntryNode, b: EntryNode) => {
          const [x, y] = [order(a), order(b)]
          return (
            x[0] - y[0] ||
            x[1].localeCompare(y[1]) ||
            x[2] - y[2] ||
            x[3].localeCompare(y[3]) ||
            x[4].localeCompare(y[4])
          )
        }
        const [next] = world.entries.filter(claimable).sort(compare)
        if (!next) return null
        const claimed = { ...lease, entryId: next.id, claimedAt: now }
        world.leases.splice(0, world.leases.length, ...world.leases.filter((held) => held.entryId !== next.id), claimed)
        world.claimed.set(next.id, now)
        return { lease: claimed, entry: next }
      },
      recordClaimedWork: async (lease, openWork) => {
        if (!world.leases.some((held) => held.id === lease.id)) throw new Error(`Lease ${lease.id} vanished.`)
        workOf(lease.entryId).claimedWork = openWork
      },
      markSeed: async (entryId) => {
        world.seeds.add(entryId)
      },
      findLease: async (id) => world.leases.find((lease) => lease.id === id) ?? null,
      complete: async (lease, at, note) => {
        const index = world.leases.findIndex(
          (held) => held.id === lease.id && held.holder === lease.holder && held.expiresAt > at,
        )
        if (index < 0) return false
        world.leases.splice(index, 1)
        world.worked.set(lease.entryId, { lastWorkedAt: at, lastWorkedBy: lease.holder, lastNote: note })
        workOf(lease.entryId).revision += 1
        return true
      },
      listStale: async (nodeIds) => {
        const owners = new Set<EntryId>([
          ...world.entries.filter((entry) => nodeIds.includes(entry.id)).map((entry) => entry.id),
          ...world.senses.filter((sense) => nodeIds.includes(sense.id)).map((sense) => sense.entryId),
        ])
        return [...owners].filter(isStale).map(staleOf)
      },
      listAnyStale: async (limit) => [...world.work.keys()].filter(isStale).slice(0, limit).map(staleOf),
      saveScores: async (stale, scores) => {
        const row = workOf(stale.entryId)
        if (row.revision !== stale.revision) return
        Object.assign(row, scores, { scoredRevision: stale.revision })
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
    authVerifier: {
      verify: async (token) => ({ sub: token.replace(/^oidc:/, ''), email: null, name: null }),
    },
    agentKeys: {
      randomSecret: () => `secret${counter + 1}`,
      hash: async (key) => `hash(${key})`,
    },
    adminSubjects: new Set(['admin-1']),
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
