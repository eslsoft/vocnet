import type { EntrySnapshot } from '@server/domain/catalog-view'
import type { Fact, FactOf } from '@server/domain/fact'
import { factKinds } from '@server/domain/fact-kinds'
import { isLive } from '@server/domain/fact-lifecycle'
import type { FeedbackRecord } from '@server/domain/feedback'
import type { EntryNode, SenseNode } from '@server/domain/nodes'
import type { WorkLease } from '@server/domain/work'
import type { Deps } from '@server/usecases/deps'
import { ConflictError } from '@server/usecases/errors'
import type { AgentRecord, JevAnswers, LlmJudgement, NodeRepo, ReviewJob } from '@server/usecases/ports'
import type { AgentId } from '@shared/agents'
import type { EntryId, FactId, SenseId } from '@shared/facts'
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
  feedback: FeedbackRecord[]
  agents: Array<AgentRecord & { keyHash: string }>
  leases: WorkLease[]
  claimed: Map<EntryId, { at: string; count: number }>
  worked: Map<EntryId, { lastWorkedAt: string; lastWorkedBy: string; lastNote: string | null }>
  queued: ReviewJob[]
  /** Client keys the feedback limiter refuses. */
  limitedClients: Set<string>
  jevCalls: Array<{ questions: Record<string, string>; state: Record<string, unknown> }>
  llmCalls: Array<{ system: string; user: string }>
  setNow(iso: string): void
  answerJev(answer: (questions: Record<string, string>) => JevAnswers | Promise<JevAnswers>): void
  answerLlm(answer: () => LlmJudgement | Promise<LlmJudgement>): void
}

export function fakeWorld(): FakeWorld {
  let now = new Date('2026-01-01T00:00:00.000Z')
  let counter = 0
  const nextId = <T extends string>() => {
    counter += 1
    return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}` as T
  }
  let jevAnswer: (questions: Record<string, string>) => JevAnswers | Promise<JevAnswers> = (questions) => ({
    model: 'jev-test',
    answers: Object.fromEntries(Object.keys(questions).map((key) => [key, 0.95])),
  })
  let llmAnswer: () => LlmJudgement | Promise<LlmJudgement> = () => ({
    model: 'llm-test',
    verdict: 'pass',
    confidence: 0.9,
    reason: 'Looks right.',
  })

  const world: Omit<FakeWorld, 'deps'> = {
    entries: [],
    senses: [],
    facts: [],
    feedback: [],
    agents: [],
    leases: [],
    claimed: new Map(),
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
  }

  const lemmaOf = (entryId: EntryId) => world.entries.find((entry) => entry.id === entryId)?.lemma
  const withLemma = (sense: SenseNode) => ({ ...sense, lemma: lemmaOf(sense.entryId) ?? ('' as never) })
  const live = (fact: Fact) => isLive(fact.status)
  const findLive = (kind: string, subjectId: string, contentKey: string) =>
    world.facts.find(
      (fact) => fact.kind === kind && fact.subjectId === subjectId && fact.contentKey === contentKey && live(fact),
    ) ?? null
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
      return entry
    },
    findSense: async (id) => {
      const sense = world.senses.find((candidate) => candidate.id === id)
      return sense ? withLemma(sense) : null
    },
    findSenseByGloss: async (entryId, pos, contentKey) => {
      for (const sense of world.senses.filter((s) => s.entryId === entryId && s.pos === pos)) {
        const fact = findLive('sense', sense.id, contentKey)
        if (fact) return { sense, fact }
      }
      return null
    },
    insertSenseWithFact: async (sense, fact) => {
      const existing = world.senses.find(
        (candidate) =>
          candidate.entryId === sense.entryId &&
          candidate.pos === sense.pos &&
          creationKeys.get(candidate.id) === fact.contentKey,
      )
      if (existing) {
        const defining = world.facts.find(
          (candidate) => candidate.subjectId === existing.id && candidate.contentKey === fact.contentKey,
        )
        if (!defining) throw new Error(`Sense ${existing.id} has no defining fact.`)
        return { sense: existing, fact: defining }
      }
      world.senses.push(sense)
      creationKeys.set(sense.id, fact.contentKey)
      world.facts.push(fact)
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
        senses: own.map(withLemma),
        facts,
        incoming,
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
      listLive: async (kind, subjectId) =>
        world.facts.filter((fact) => fact.kind === kind && fact.subjectId === subjectId && live(fact)),
      insert: async (fact) => {
        const existing = findLive(fact.kind, fact.subjectId, fact.contentKey)
        if (existing) return existing
        if (violatesIndexes(world.facts, fact)) return null
        world.facts.push(fact)
        return fact
      },
      transition: async ({ id, from, to, at, review, supersede, revalidate, revalidateSince }) => {
        const fact = world.facts.find((candidate) => candidate.id === id)
        if (!fact || !from.includes(fact.status)) return false
        if (revalidateSince !== undefined && fact.revalidateSince !== revalidateSince) return false
        const next = {
          ...fact,
          status: to,
          updatedAt: at,
          review: review ?? fact.review,
          revalidateSince: null,
        } as Fact
        const dependsOnNode = (candidate: Fact) =>
          revalidate !== undefined &&
          candidate.status === 'published' &&
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
        return true
      },
      listRevalidating: async (nodeId) =>
        world.facts
          .filter((fact) => fact.status === 'published' && fact.revalidateSince !== null)
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
    feedback: {
      insert: async (item) => {
        world.feedback.push(item)
      },
      find: async (id) => world.feedback.find((item) => item.id === id) ?? null,
      update: async (next, expectedRevision) => {
        const index = world.feedback.findIndex((item) => item.id === next.id)
        if (world.feedback[index]?.revision !== expectedRevision) return false
        world.feedback[index] = next
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
        const free = (entry: EntryNode) =>
          world.facts.some((fact) => fact.kind === 'entry' && fact.subjectId === entry.id && live(fact)) &&
          !world.leases.some((held) => held.entryId === entry.id && held.expiresAt > now)
        const rank = (count = 0) => (count === 1 ? 0 : count === 0 ? 1 : 2)
        const order = (entry: EntryNode) => {
          const claim = world.claimed.get(entry.id)
          return [rank(claim?.count), claim?.at ?? '', entry.createdAt, entry.id]
        }
        const [next] = world.entries.filter(free).sort((a, b) => order(a).join('|').localeCompare(order(b).join('|')))
        if (!next) return null
        const claimed = { ...lease, entryId: next.id }
        world.leases.splice(0, world.leases.length, ...world.leases.filter((held) => held.entryId !== next.id), claimed)
        world.claimed.set(next.id, { at: now, count: (world.claimed.get(next.id)?.count ?? 0) + 1 })
        return { lease: claimed, entry: next }
      },
      findLease: async (id) => world.leases.find((lease) => lease.id === id) ?? null,
      complete: async (lease, at, note) => {
        const index = world.leases.findIndex(
          (held) => held.id === lease.id && held.holder === lease.holder && held.expiresAt > at,
        )
        if (index < 0) return false
        world.leases.splice(index, 1)
        world.worked.set(lease.entryId, { lastWorkedAt: at, lastWorkedBy: lease.holder, lastNote: note })
        return true
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
