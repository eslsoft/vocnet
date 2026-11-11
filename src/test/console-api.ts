import type { AgentDto } from '@shared/agents'
import type { EntrySummary } from '@shared/catalog'
import type { FactDto, Review } from '@shared/facts'
import type { FeedbackDto } from '@shared/feedback'
import type { ConsoleStats, WorkAttemptDto, WorkItemDetail, WorkSummary } from '@shared/monitor'
import type { LemmaReference, ReferenceSource } from '@shared/reference'
import { HttpResponse, http } from 'msw'

// An in-memory management API at the network edge, so pages read converging state instead of
// fixed responses. Builders return payloads that parse with the shared wire schemas.

const at = '2026-11-01T10:00:00.000Z'
const id = () => crypto.randomUUID()

/** An ISO time `seconds` from now: negative is in the past. */
export const fromNow = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString()

export interface EntryRecord {
  id: string
  lemma: string
  last_worked_at?: string
  /** Fields of the entry's summary and management view that the facts do not derive. */
  summary?: Partial<Pick<EntrySummary, 'level' | 'completeness' | 'quality' | 'slots' | 'open_work'>>
}
export interface SenseRecord {
  id: string
  entry_id: string
  pos: 'noun' | 'verb' | 'adjective'
}

export function review(overrides: Partial<Review> = {}): Review {
  return {
    reviewer: 'jev',
    model: 'jev-latest',
    verdict: 'pass',
    confidence: 0.93,
    reason: 'Established.',
    context: {},
    detail: {},
    reviewed_at: at,
    ...overrides,
  }
}

type FactInput = Pick<FactDto, 'kind' | 'payload'> & Partial<Omit<FactDto, 'kind' | 'payload'>>

export function fact(input: FactInput): FactDto {
  return {
    id: id(),
    subject_id: id(),
    object_id: null,
    status: 'published',
    supersedes_id: null,
    author: 'agent:producer',
    review: review(),
    created_at: at,
    updated_at: at,
    ...input,
  } as FactDto
}

export function feedbackItem(
  input: Partial<FeedbackDto> & Pick<FeedbackDto, 'target_type' | 'target_id'>,
): FeedbackDto {
  return {
    id: id(),
    message: 'This gloss is wrong.',
    status: 'open',
    assignee: null,
    claim_expires_at: null,
    resolution_note: null,
    resolution_fact_ids: [],
    created_at: at,
    updated_at: at,
    ...input,
  } as FeedbackDto
}

export function agent(input: Partial<AgentDto> & Pick<AgentDto, 'name'>): AgentDto {
  return { id: id(), curator: false, created_by: 'admin:root', created_at: at, revoked_at: null, ...input } as AgentDto
}

export function consoleStats(overrides: Partial<ConsoleStats> = {}): ConsoleStats {
  return {
    facts: [],
    flagged: [],
    live_facts: 0,
    completeness: { average: 0, by_level: [] },
    pending_review: { count: 0, oldest_at: null, over_one_hour: 0 },
    feedback: { open: 0, claimed: 0, resolved: 0, dismissed: 0 },
    work: { open: 0, stuck: 0, timed_out_24h: 0 },
    ...overrides,
  }
}

export function workSummary(overrides: Partial<WorkSummary> = {}): WorkSummary {
  return {
    window: '24h',
    open: { queued: 0, in_progress: 0, waiting_on_review: 0, stuck: 0, total: 0 },
    history_since: '2026-11-01T00:00:00.000Z',
    created: 0,
    closed: 0,
    median_close_seconds: null,
    agents: 0,
    by_type: [],
    throughput: [],
    forecast: { net_per_day: 0, net_per_day_24h: 0, by_level: [] },
    leases: [],
    ...overrides,
  }
}

export function workTask(input: Partial<WorkItemDetail> & Pick<WorkItemDetail, 'entry' | 'gap'>): WorkItemDetail {
  return {
    id: id(),
    type: input.gap.type,
    stage: 4,
    subject_id: input.entry.id,
    sense_gloss: null,
    status: 'queued',
    attempts_without_progress: 0,
    lease: null,
    created_at: at,
    closed_at: null,
    attempts: [],
    agent_seconds: 0,
    queue_seconds: 60,
    ...input,
  } as WorkItemDetail
}

export function attempt(input: Partial<WorkAttemptDto> & Pick<WorkAttemptDto, 'entry' | 'type'>): WorkAttemptDto {
  return {
    id: id(),
    item_id: id(),
    attempt: 1,
    subject_id: input.entry.id,
    sense_gloss: null,
    holder: 'agent:producer',
    claimed_at: '2026-11-01T09:58:00.000Z',
    completed_at: at,
    seconds: 125,
    outcome: 'progressed',
    note: null,
    facts: [],
    ...input,
  } as WorkAttemptDto
}

export function apiError(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status })
}

function page<T>(items: T[], url: URL) {
  const start = Number(url.searchParams.get('cursor') ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? 20)
  const end = start + limit
  return { items: items.slice(start, end), next_cursor: end < items.length ? String(end) : null }
}

const isLive = (candidate: FactDto) => candidate.status === 'pending' || candidate.status === 'published'

export function consoleApi(
  seed: {
    entries?: EntryRecord[]
    senses?: SenseRecord[]
    facts?: FactDto[]
    feedback?: FeedbackDto[]
    agents?: AgentDto[]
    references?: Record<string, LemmaReference>
    /** null makes the sources endpoint fail. */
    referenceSources?: ReferenceSource[] | null
    stats?: ConsoleStats
    summary?: WorkSummary
    attempts?: WorkAttemptDto[]
    tasks?: WorkItemDetail[]
  } = {},
) {
  const state = {
    entries: seed.entries ?? [],
    senses: seed.senses ?? [],
    facts: seed.facts ?? [],
    feedback: seed.feedback ?? [],
    agents: seed.agents ?? [],
    references: seed.references ?? {},
    referenceSources: seed.referenceSources === undefined ? [] : seed.referenceSources,
    stats: seed.stats ?? consoleStats(),
    summary: seed.summary ?? workSummary(),
    attempts: seed.attempts ?? [],
    tasks: seed.tasks ?? [],
    issuedKeys: [] as string[],
  }
  const entryOfNode = (nodeId: string) =>
    state.entries.find((entry) => entry.id === nodeId) ??
    state.entries.find((entry) => entry.id === state.senses.find((sense) => sense.id === nodeId)?.entry_id)
  /** The entry a node is or belongs to, as the list endpoints join it; an orphan is a broken seed. */
  const entryRefOf = (nodeId: string) => {
    const entry = entryOfNode(nodeId)
    if (!entry) throw new Error(`The seed has no entry for node ${nodeId}.`)
    return { id: entry.id, lemma: entry.lemma }
  }
  const listedFact = (candidate: FactDto) => ({ ...candidate, entry: entryRefOf(candidate.subject_id) })
  const listedFeedback = (item: FeedbackDto) => {
    const target = state.facts.find((candidate) => candidate.id === item.target_id)
    return { ...item, entry: entryRefOf(target?.subject_id ?? item.target_id) }
  }
  const ownNodes = (entry: EntryRecord) =>
    new Set([entry.id, ...state.senses.filter((sense) => sense.entry_id === entry.id).map((sense) => sense.id)])
  const slots = { total: 10, published: 5, pending: 1 }

  const handlers = [
    http.get('/manage/v1/stats', () => HttpResponse.json(state.stats)),
    http.get('/manage/v1/work/summary', ({ request }) => {
      const window = new URL(request.url).searchParams.get('window') ?? '24h'
      return HttpResponse.json({ ...state.summary, window })
    }),
    http.get('/manage/v1/work/attempts', ({ request }) => {
      const url = new URL(request.url)
      const query = (name: string) => url.searchParams.get(name)
      const matches = state.attempts.filter(
        (candidate) =>
          (!query('outcome') || candidate.outcome === query('outcome')) &&
          (!query('type') || candidate.type === query('type')) &&
          (!query('holder') || candidate.holder === query('holder')) &&
          (!query('lemma') || candidate.entry.lemma === query('lemma')),
      )
      return HttpResponse.json(page(matches, url))
    }),
    http.get('/manage/v1/work/items', ({ request }) => {
      const url = new URL(request.url)
      const entryId = url.searchParams.get('entry_id')
      const subjectId = url.searchParams.get('subject_id')
      const items = state.tasks
        .filter((task) => task.status !== 'closed')
        .filter((task) => (entryId ? task.entry.id === entryId : task.subject_id === subjectId))
        .map(({ attempts: _, agent_seconds: __, queue_seconds: ___, ...overview }) => overview)
      return HttpResponse.json({ items })
    }),
    http.get('/manage/v1/work/items/:id', ({ params }) => {
      const found = state.tasks.find((task) => task.id === params.id)
      return found ? HttpResponse.json(found) : apiError(404, 'not_found', 'Work item not found.')
    }),
    http.get('/manage/v1/facts', ({ request }) => {
      const url = new URL(request.url)
      const query = (name: string) => url.searchParams.get(name)
      const matches = state.facts.filter(
        (candidate) =>
          (!query('status') || candidate.status === query('status')) &&
          (!query('kind') || candidate.kind === query('kind')) &&
          (!query('author') || candidate.author === query('author')) &&
          (!query('weak') ||
            (candidate.status === 'published' && candidate.review !== null && candidate.review.verdict !== 'pass')) &&
          (!query('lemma') || entryOfNode(candidate.subject_id)?.lemma === query('lemma')) &&
          (!query('level') || entryOfNode(candidate.subject_id)?.summary?.level === query('level')),
      )
      return HttpResponse.json(page(matches.map(listedFact), url))
    }),
    http.get('/manage/v1/facts/:id', ({ params }) => {
      const found = state.facts.find((candidate) => candidate.id === params.id)
      return found ? HttpResponse.json(listedFact(found)) : apiError(404, 'not_found', 'Fact not found.')
    }),
    http.get('/manage/v1/entries', ({ request }) => {
      const url = new URL(request.url)
      const query = (name: string) => url.searchParams.get(name)
      const summaries = state.entries
        .filter((entry) => entry.lemma.startsWith(query('prefix') ?? ''))
        .filter((entry) => !query('level') || entry.summary?.level === query('level'))
        .filter((entry) => !query('flagged') || (entry.summary?.quality ?? 1) < 1)
        .filter((entry) => !query('stuck') || (entry.summary?.open_work?.stuck ?? 0) > 0)
        .sort((a, b) => a.lemma.localeCompare(b.lemma))
        .map((entry): EntrySummary => {
          const own = ownNodes(entry)
          const facts = state.facts.filter((candidate) => own.has(candidate.subject_id))
          const count = (status: FactDto['status']) => facts.filter((candidate) => candidate.status === status).length
          return {
            id: entry.id as EntrySummary['id'],
            lemma: entry.lemma,
            entry_status: facts.find((candidate) => candidate.kind === 'entry')?.status ?? null,
            sense_count: facts.filter((candidate) => candidate.kind === 'sense' && isLive(candidate)).length,
            fact_counts: {
              pending: count('pending'),
              published: count('published'),
              rejected: count('rejected'),
              superseded: count('superseded'),
              retracted: count('retracted'),
            },
            last_worked_at: entry.last_worked_at ?? null,
            created_at: at,
            level: null,
            completeness: 0.6,
            quality: 1,
            slots,
            open_work: { total: 0, in_progress: 0, waiting_on_review: 0, stuck: 0 },
            ...entry.summary,
          }
        })
      return HttpResponse.json(page(summaries, url))
    }),
    http.get('/manage/v1/entries/:lemma', ({ params }) => {
      const entry = state.entries.find((candidate) => candidate.lemma === params.lemma)
      if (!entry) return apiError(404, 'not_found', `No entry for "${params.lemma}".`)
      const senses = state.senses.filter((sense) => sense.entry_id === entry.id)
      const nodeIds = ownNodes(entry)
      const facts = state.facts.filter(
        (candidate) => nodeIds.has(candidate.subject_id) || nodeIds.has(candidate.object_id ?? ''),
      )
      return HttpResponse.json({
        entry: { id: entry.id, lemma: entry.lemma, created_by: 'agent:producer', created_at: at },
        seed: false,
        completeness: entry.summary?.completeness ?? 0.6,
        quality: entry.summary?.quality ?? 1,
        slots: entry.summary?.slots ?? slots,
        senses: senses.map((sense) => ({ ...sense, created_by: 'agent:producer', created_at: at })),
        facts,
        ...(state.references[entry.lemma] ?? { frequency: null, cefr: [] }),
      })
    }),
    http.get('/manage/v1/sources', () => {
      if (state.referenceSources === null) return apiError(403, 'forbidden', 'Sources are unavailable.')
      return HttpResponse.json({ items: state.referenceSources })
    }),
    http.get('/manage/v1/nodes/:id', ({ params }) => {
      const entry = state.entries.find((candidate) => candidate.id === params.id)
      if (entry) return HttpResponse.json({ node_type: 'entry', entry: { id: entry.id, lemma: entry.lemma } })
      const owner = entryOfNode(String(params.id))
      if (owner) return HttpResponse.json({ node_type: 'sense', entry: { id: owner.id, lemma: owner.lemma } })
      return apiError(404, 'not_found', 'No entry or sense has this id.')
    }),
    http.get('/manage/v1/feedback', ({ request }) => {
      const url = new URL(request.url)
      const status = url.searchParams.get('status')
      return HttpResponse.json(
        page(state.feedback.filter((item) => !status || item.status === status).map(listedFeedback), url),
      )
    }),
    http.get('/manage/v1/feedback/:id', ({ params }) => {
      const found = state.feedback.find((item) => item.id === params.id)
      return found ? HttpResponse.json(listedFeedback(found)) : apiError(404, 'not_found', 'Feedback not found.')
    }),
    http.get('/manage/v1/agents', () => HttpResponse.json({ items: state.agents })),
    http.post('/manage/v1/agents', async ({ request }) => {
      const { name } = (await request.json()) as { name: string }
      const created = agent({ name })
      const key = `vn_agent_${id()}`
      state.agents = [...state.agents, created]
      state.issuedKeys.push(key)
      return HttpResponse.json({ agent: created, key }, { status: 201 })
    }),
    http.delete('/manage/v1/agents/:id', ({ params }) => {
      const found = state.agents.find((candidate) => candidate.id === params.id)
      if (!found) return apiError(404, 'not_found', 'Agent not found.')
      const revoked = { ...found, revoked_at: found.revoked_at ?? at }
      state.agents = state.agents.map((candidate) => (candidate.id === revoked.id ? revoked : candidate))
      return HttpResponse.json(revoked)
    }),
  ]
  return { state, handlers }
}
