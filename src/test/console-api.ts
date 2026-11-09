import type { AgentDto } from '@shared/agents'
import type { FactDto, Review } from '@shared/facts'
import type { FeedbackDto } from '@shared/feedback'
import { HttpResponse, http } from 'msw'

// An in-memory management API at the network edge, so mutate → invalidate → refetch
// flows converge on real state instead of fixed responses.

const at = '2026-11-01T10:00:00.000Z'
const id = () => crypto.randomUUID()

export interface EntryRecord {
  id: string
  lemma: string
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
  return { id: id(), created_by: 'admin:root', created_at: at, revoked_at: null, ...input } as AgentDto
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

export function consoleApi(
  seed: {
    entries?: EntryRecord[]
    senses?: SenseRecord[]
    facts?: FactDto[]
    feedback?: FeedbackDto[]
    agents?: AgentDto[]
  } = {},
) {
  const state = {
    entries: seed.entries ?? [],
    senses: seed.senses ?? [],
    facts: seed.facts ?? [],
    feedback: seed.feedback ?? [],
    agents: seed.agents ?? [],
    issuedKeys: [] as string[],
  }
  const findFact = (factId: string) => state.facts.find((candidate) => candidate.id === factId)
  const replaceFact = (next: FactDto) => {
    state.facts = state.facts.map((candidate) => (candidate.id === next.id ? next : candidate))
    return HttpResponse.json(next)
  }

  const handlers = [
    http.get('/manage/v1/stats', () => {
      const counts = new Map<string, { kind: string; status: string; count: number }>()
      for (const { kind, status } of state.facts) {
        const key = `${kind}/${status}`
        counts.set(key, { kind, status, count: (counts.get(key)?.count ?? 0) + 1 })
      }
      const open = state.feedback.filter((item) => item.status === 'open').length
      return HttpResponse.json({ facts: [...counts.values()], open_feedback: open })
    }),
    http.get('/manage/v1/facts', ({ request }) => {
      const url = new URL(request.url)
      const status = url.searchParams.get('status')
      const kind = url.searchParams.get('kind')
      const matches = state.facts.filter(
        (candidate) => (!status || candidate.status === status) && (!kind || candidate.kind === kind),
      )
      return HttpResponse.json(page(matches, url))
    }),
    http.get('/manage/v1/facts/:id', ({ params }) => {
      const found = findFact(String(params.id))
      return found ? HttpResponse.json(found) : apiError(404, 'not_found', 'Fact not found.')
    }),
    http.post('/manage/v1/facts/:id/retract', ({ params }) => {
      const found = findFact(String(params.id))
      if (!found) return apiError(404, 'not_found', 'Fact not found.')
      if (found.status !== 'pending' && found.status !== 'published') {
        return apiError(409, 'conflict', `Cannot retract a ${found.status} fact.`)
      }
      return replaceFact({ ...found, status: 'retracted' })
    }),
    http.post('/manage/v1/facts/:id/rereview', ({ params }) => {
      const found = findFact(String(params.id))
      if (!found) return apiError(404, 'not_found', 'Fact not found.')
      return replaceFact({ ...found, status: 'pending', review: null })
    }),
    http.get('/manage/v1/entries/:lemma', ({ params }) => {
      const entry = state.entries.find((candidate) => candidate.lemma === params.lemma)
      if (!entry) return apiError(404, 'not_found', `No entry for "${params.lemma}".`)
      const senses = state.senses.filter((sense) => sense.entry_id === entry.id)
      const nodeIds = new Set([entry.id, ...senses.map((sense) => sense.id)])
      const facts = state.facts.filter(
        (candidate) => nodeIds.has(candidate.subject_id) || nodeIds.has(candidate.object_id ?? ''),
      )
      return HttpResponse.json({
        entry: { ...entry, created_by: 'agent:producer', created_at: at },
        senses: senses.map((sense) => ({ ...sense, created_by: 'agent:producer', created_at: at })),
        facts,
      })
    }),
    http.get('/manage/v1/nodes/:id', ({ params }) => {
      const entry = state.entries.find((candidate) => candidate.id === params.id)
      if (entry) return HttpResponse.json({ node_type: 'entry', entry })
      const sense = state.senses.find((candidate) => candidate.id === params.id)
      const owner = sense && state.entries.find((candidate) => candidate.id === sense.entry_id)
      if (owner) return HttpResponse.json({ node_type: 'sense', entry: owner })
      return apiError(404, 'not_found', 'No entry or sense has this id.')
    }),
    http.get('/manage/v1/feedback', ({ request }) => {
      const url = new URL(request.url)
      const status = url.searchParams.get('status')
      return HttpResponse.json(
        page(
          state.feedback.filter((item) => !status || item.status === status),
          url,
        ),
      )
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
