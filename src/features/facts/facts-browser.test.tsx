import type { FactDto } from '@shared/facts'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { agent, apiError, consoleApi, fact, review, workTask } from '@/test/console-api'
import { server } from '@/test/msw'
import { renderAt } from '@/test/render'
import { chooseOption } from '@/test/select'
import { HEAVY_TEST_MS } from '@/test/timeouts'
import { FactSheet, FactsBrowser } from './index'

const routes = [
  { path: '/console/facts', element: <FactsBrowser flagged={386} /> },
  { path: '/console/entries/:lemma', element: <FactSheet /> },
]

const producer = agent({ name: 'producer-a1' })
const run = { id: crypto.randomUUID(), lemma: 'run', summary: { level: 'A1' as const } }
const get = { id: crypto.randomUUID(), lemma: 'get' }
const obtain = { id: crypto.randomUUID(), lemma: 'obtain' }
const speed = { id: crypto.randomUUID(), entry_id: run.id, pos: 'verb' as const }
const manage = { id: crypto.randomUUID(), entry_id: run.id, pos: 'verb' as const }
const getSense = { id: crypto.randomUUID(), entry_id: get.id, pos: 'verb' as const }
const obtainSense = { id: crypto.randomUUID(), entry_id: obtain.id, pos: 'verb' as const }

function example(text: string, overrides: Partial<FactDto> = {}) {
  return fact({ kind: 'example', payload: { text }, subject_id: speed.id, ...overrides } as FactDto)
}

function world() {
  const replaced = example('She runs every morning before work.', {
    status: 'superseded',
    created_at: '2026-11-02T08:40:00.000Z',
  })
  const flagged = example('She ran to catch the last bus.', {
    payload: { text: 'She ran to catch the last bus.', translations: { zh: '她跑着去赶末班车。' } },
    supersedes_id: replaced.id,
    author: `agent:${producer.id}`,
    created_at: '2026-11-10T21:02:00.000Z',
    review: review({
      reviewer: 'llm',
      model: 'claude-sonnet',
      verdict: 'uncertain',
      confidence: 0.62,
      reason: 'It leans toward hurrying.',
    }),
  })
  const facts = [
    fact({ kind: 'entry', payload: {}, subject_id: run.id }),
    fact({ kind: 'sense', payload: { gloss: 'move at a speed faster than walking' }, subject_id: speed.id }),
    fact({ kind: 'sense', payload: { gloss: 'be in charge of' }, subject_id: manage.id }),
    replaced,
    flagged,
    fact({
      kind: 'relation',
      payload: { type: 'synonym', target_sense_id: obtainSense.id as never },
      subject_id: getSense.id,
      object_id: obtainSense.id as never,
      review: review({ verdict: 'fail', confidence: 0.3 }),
    }),
    example('He ran across the road.', { status: 'rejected', review: review({ verdict: 'fail', confidence: 0.1 }) }),
    example('Fresh', { status: 'pending', review: null }),
  ]
  const task = workTask({
    entry: run as never,
    subject_id: flagged.id,
    stage: 5,
    gap: { type: 'weak_fact', fact_id: flagged.id, kind: 'example', reason: 'uncertain' },
  })
  const api = consoleApi({
    entries: [run, get, obtain],
    senses: [speed, manage, getSense, obtainSense],
    facts,
    tasks: [task],
    agents: [producer],
  })
  return { api, flagged, replaced, task }
}

const detail = () => screen.getByRole('region', { name: 'Fact detail' })

describe('FactsBrowser', () => {
  it(
    'lists facts with their lemma, claim, and state, filtered in the URL [spec: console/facts-browse]',
    async () => {
      const { api } = world()
      server.use(...api.handlers)
      const view = renderAt('/console/facts', routes)

      expect(screen.getByText('386 flagged · newest first')).toBeInTheDocument()
      const list = await screen.findByRole('list', { name: 'Facts' })
      const flaggedRow = (await within(list).findByText('She ran to catch the last bus.')).closest(
        'button',
      ) as HTMLElement
      expect(await within(flaggedRow).findByText('run')).toBeInTheDocument()
      expect(within(flaggedRow).getByText('Example')).toBeInTheDocument()
      expect(within(flaggedRow).getByText('她跑着去赶末班车。')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Flagged only' }))
      await waitFor(() => expect(view.location()).toBe('/console/facts?flagged=true'))
      await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2))

      await chooseOption('Type', 'Relation')
      await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1))
      expect(await within(list).findByText('obtain')).toBeInTheDocument()
      await chooseOption('Type', 'All')
      await chooseOption('Level', 'A1')
      await chooseOption('Author', 'producer-a1')
      await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1))
      expect(view.location()).toBe(`/console/facts?flagged=true&level=A1&author=agent%3A${producer.id}`)

      fireEvent.click(screen.getByRole('button', { name: 'Flagged only' }))
      await chooseOption('Status', 'Rejected')
      expect(await screen.findByText('No facts match these filters.')).toBeInTheDocument()

      fireEvent.change(screen.getByRole('searchbox', { name: 'Entry' }), { target: { value: 'run' } })
      await waitFor(() => expect(view.location()).toContain('entry=run'))
    },
    HEAVY_TEST_MS,
  )

  it('marks flagged, failed, pending, and rejected facts [spec: console/flagged-facts]', async () => {
    server.use(...world().api.handlers)
    renderAt('/console/facts', routes)
    const badgeOf = async (text: string) => {
      const row = (await screen.findByText(text)).closest('button') as HTMLElement
      return within(row).getAllByText(/./, { selector: '[data-slot=badge]' })[0]
    }
    expect(await badgeOf('She ran to catch the last bus.')).toHaveTextContent('Flagged · 62%')
    expect(await badgeOf('Fresh')).toHaveTextContent('Pending')
    expect(await badgeOf('He ran across the road.')).toHaveTextContent('Rejected')
    expect(screen.getByText('He ran across the road.').closest('span.line-through')).not.toBeNull()
    expect(screen.getAllByText('Review failed')).toHaveLength(1)
    expect(screen.getAllByText('Replaced')).toHaveLength(1)
  })

  it('shows a fact read-only with its claim, review, task, and history [spec: console/fact-detail]', async () => {
    const { api, flagged, replaced, task } = world()
    server.use(...api.handlers)
    const view = renderAt('/console/facts', routes)
    expect(screen.getByText('Select a fact to see its claim, review, and history.')).toBeInTheDocument()
    fireEvent.click(await screen.findByText('She ran to catch the last bus.'))
    expect(view.location()).toBe(`/console/facts?fact=${flagged.id}`)

    expect(await within(detail()).findByText('Example · Sense 1 · verb')).toBeInTheDocument()
    expect(within(detail()).getByRole('heading', { name: 'run' })).toBeInTheDocument()
    expect(within(detail()).getByText('Flagged · 62% confidence')).toBeInTheDocument()
    expect(within(detail()).getByText('Sense 1 · move at a speed faster than walking')).toBeInTheDocument()
    expect(within(detail()).getByText('Technical details')).toBeInTheDocument()
    expect(within(detail()).getByText(flagged.id)).not.toBeVisible()

    const verdict = within(detail()).getByRole('region', { name: 'Review' })
    expect(verdict).toHaveTextContent('Uncertain62%It leans toward hurrying.llm · claude-sonnet')
    expect(verdict.className).toContain('bg-warning')
    expect(await within(detail()).findByRole('link', { name: /Task · Fix flagged fact/ })).toHaveAttribute(
      'href',
      `/console/tasks/activity?task=${task.id}`,
    )
    expect(within(detail()).getByRole('link', { name: 'Open entry' })).toHaveAttribute('href', '/console/entries/run')
    expect(within(detail()).queryByRole('button', { name: /retract|re-review/i })).not.toBeInTheDocument()

    const history = (await within(detail()).findByText('History')).closest('section') as HTMLElement
    const entries = within(history).getAllByRole('button')
    expect(entries.map((entry) => entry.textContent)).toEqual([
      expect.stringMatching(/^PublishedShe ran to catch the last bus\. · zh: 她跑着去赶末班车。producer-a1 · /),
      expect.stringMatching(/^ReplacedShe runs every morning before work\.agent:producer · /),
    ])
    expect(entries[0]).toBeDisabled()
    fireEvent.click(entries[1] as HTMLElement)
    expect(view.location()).toBe(`/console/facts?fact=${replaced.id}`)
    expect(await within(detail()).findByText('Passed review')).toBeInTheDocument()
  })

  it('shows relations, failed reviews, and unreviewed facts in the detail', async () => {
    const { api } = world()
    server.use(...api.handlers)
    const relation = api.state.facts.find((candidate) => candidate.kind === 'relation') as FactDto
    const pending = api.state.facts.find((candidate) => candidate.status === 'pending') as FactDto
    renderAt(`/console/facts?fact=${relation.id}`, routes)
    expect(await within(detail()).findByRole('heading', { name: 'get' })).toBeInTheDocument()
    expect(await within(detail()).findAllByText('obtain')).not.toHaveLength(0)
    expect(within(detail()).getByRole('region', { name: 'Review' }).className).toContain('bg-destructive')

    fireEvent.click(await screen.findByText('Fresh'))
    expect(await within(detail()).findByText('Not reviewed yet.')).toBeInTheDocument()
    expect(within(detail()).getByText('Pending')).toBeInTheDocument()
    expect(pending.status).toBe('pending')
  })

  it('opens a fact over another page in a sheet', async () => {
    const { api, flagged } = world()
    server.use(...api.handlers)
    const view = renderAt(`/console/entries/run?fact=${flagged.id}`, routes)
    const sheet = await screen.findByRole('dialog')
    expect(await within(sheet).findByText('Flagged · 62% confidence')).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(view.location()).toBe('/console/entries/run'))
  })

  it("surfaces a missing fact, its entry's failed read, and a failed list", async () => {
    const lone = example('Lone')
    server.use(
      http.get('/manage/v1/entries/:lemma', () => apiError(404, 'not_found', 'No entry for "run".')),
      ...consoleApi({ entries: [run], senses: [speed], facts: [lone] }).handlers,
    )
    renderAt(`/console/facts?fact=${lone.id}`, routes)
    expect(await within(detail()).findByText('No entry for "run".')).toBeInTheDocument()
    expect(within(detail()).getByRole('heading', { name: 'run' })).toBeInTheDocument()

    server.use(http.get('/manage/v1/facts/:id', () => apiError(404, 'not_found', 'Fact not found.')))
    renderAt(`/console/facts?fact=${crypto.randomUUID()}`, routes)
    expect(await screen.findByText('Fact not found.')).toBeInTheDocument()

    server.use(http.get('/manage/v1/facts', () => apiError(403, 'forbidden', 'Admins only.')))
    renderAt('/console/facts', [{ path: '/console/facts', element: <FactsBrowser /> }])
    expect(await screen.findByText('Admins only.')).toBeInTheDocument()
    expect(screen.getByText('Newest first')).toBeInTheDocument()
  })

  it('pages through the list', async () => {
    const many = Array.from({ length: 30 }, (_, index) => example(`Example ${index}`))
    server.use(...consoleApi({ entries: [run], senses: [speed], facts: many }).handlers)
    renderAt('/console/facts', routes)
    expect(await screen.findByText('Example 24')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Example 29')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })
})
