import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { agent, apiError, consoleApi, fact, feedbackItem, review, workTask } from '@/test/console-api'
import { server } from '@/test/msw'
import { renderAt } from '@/test/render'
import { TicketsBrowser } from './index'

const counts = { open: 5, claimed: 1, resolved: 7, dismissed: 2 }
const routes = [{ path: '/console/tickets', element: <TicketsBrowser counts={counts} /> }]

function world() {
  const fixer = agent({ name: 'fixer' })
  const light = { id: crypto.randomUUID(), lemma: 'light' }
  const bank = { id: crypto.randomUUID(), lemma: 'bank' }
  const sense = { id: crypto.randomUUID(), entry_id: light.id, pos: 'noun' as const }
  const translation = fact({
    kind: 'translation',
    payload: { language: 'zh', text: '轻的' },
    subject_id: sense.id,
    review: review({ verdict: 'fail', confidence: 0.2 }),
  })
  const correction = fact({ kind: 'translation', payload: { language: 'zh', text: '光' }, subject_id: sense.id })
  const aboutFact = feedbackItem({
    target_type: 'fact',
    target_id: translation.id,
    message: '“轻的” sits under the noun sense.',
    created_at: '2026-11-10T18:42:00.000Z',
  })
  const assigned = feedbackItem({
    target_type: 'sense',
    target_id: sense.id,
    message: 'The sense has no example.',
    status: 'claimed',
    assignee: `agent:${fixer.id}`,
  })
  const resolved = feedbackItem({
    target_type: 'entry',
    target_id: bank.id,
    message: 'Missing plural.',
    status: 'resolved',
    assignee: `agent:${fixer.id}`,
    resolution_note: 'Added the plural.',
    resolution_fact_ids: [correction.id],
    created_at: '2026-11-03T00:00:00.000Z',
  })
  const dismissed = feedbackItem({
    target_type: 'entry',
    target_id: bank.id,
    message: 'Not a real problem.',
    status: 'dismissed',
    created_at: '2026-11-04T00:00:00.000Z',
  })
  const task = workTask({
    entry: light as never,
    subject_id: translation.id,
    stage: 5,
    gap: { type: 'weak_fact', fact_id: translation.id, kind: 'translation', reason: 'feedback' },
  })
  const api = consoleApi({
    entries: [light, bank],
    senses: [sense],
    facts: [translation, correction],
    feedback: [aboutFact, assigned, resolved, dismissed],
    tasks: [task],
    agents: [fixer],
  })
  return { api, aboutFact, assigned, resolved, correction, task }
}

const detail = () => screen.getByRole('region', { name: 'Ticket detail' })

describe('TicketsBrowser', () => {
  it('lists tickets by tab and shows one read-only with what it is about [spec: console/tickets]', async () => {
    const { api, aboutFact, task } = world()
    server.use(...api.handlers)
    const view = renderAt('/console/tickets', routes)

    expect(screen.getByRole('tab', { name: 'Open · 5' })).toHaveAttribute('aria-selected', 'true')
    const row = (await screen.findByText('“轻的” sits under the noun sense.')).closest('button') as HTMLElement
    expect(await within(row).findByText('light')).toBeInTheDocument()
    expect(within(row).getByText('Fact')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Open · 5',
      'Assigned · 1',
      'Resolved · 9',
      'All · 15',
    ])
    expect(screen.queryByText('Missing plural.')).not.toBeInTheDocument()

    fireEvent.click(row)
    expect(view.location()).toBe(`/console/tickets?ticket=${aboutFact.id}`)
    expect(await within(detail()).findByRole('heading', { name: 'light' })).toBeInTheDocument()
    expect(within(detail()).getByText('Open')).toBeInTheDocument()
    expect(within(detail()).getByText('About this fact')).toBeInTheDocument()
    expect(await within(detail()).findByText('轻的')).toBeInTheDocument()
    expect(within(detail()).getByText('Published')).toBeInTheDocument()
    expect(within(detail()).getByText('Review failed')).toBeInTheDocument()
    expect(await within(detail()).findByRole('link', { name: /Fix flagged fact/ })).toHaveAttribute(
      'href',
      `/console/tasks/activity?task=${task.id}`,
    )
    expect(within(detail()).getByRole('link', { name: 'Open entry' })).toHaveAttribute('href', '/console/entries/light')
    expect(within(detail()).getByText('Read-only. Agents resolve tickets through the API.')).toBeInTheDocument()
    expect(within(detail()).queryByRole('button')).not.toBeInTheDocument()
  })

  it('groups resolved and dismissed tickets and deep-links one by id [spec: console/tickets]', async () => {
    const { api, resolved, correction } = world()
    server.use(...api.handlers)
    const view = renderAt(`/console/tickets?tab=resolved&ticket=${resolved.id}`, routes)

    const list = await screen.findByRole('list', { name: 'Tickets' })
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual([expect.stringContaining('Not a real problem.'), expect.stringContaining('Missing plural.')]),
    )
    expect(await within(detail()).findByText('About this entry')).toBeInTheDocument()
    expect(await within(detail()).findByText('fixer')).toBeInTheDocument()
    expect(within(detail()).getByText('Added the plural.')).toBeInTheDocument()
    expect(within(detail()).getByRole('link', { name: correction.id })).toHaveAttribute(
      'href',
      `/console/facts?fact=${correction.id}`,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Assigned · 1' }))
    await waitFor(() => expect(view.location()).toBe(`/console/tickets?tab=assigned&ticket=${resolved.id}`))
    fireEvent.click(await screen.findByText('The sense has no example.'))
    expect(await within(detail()).findByText('About this sense')).toBeInTheDocument()
    expect(within(detail()).getByText('Assigned')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'All · 15' }))
    expect(await screen.findByText('Missing plural.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Open · 5' }))
    await waitFor(() => expect(view.location()).not.toContain('tab='))
  })

  it('says when a tab is empty, pages through it, and shows a missing ticket', async () => {
    const { api } = world()
    const filler = Array.from({ length: 30 }, (_, index) =>
      feedbackItem({ target_type: 'entry', target_id: api.state.entries[1]?.id as string, message: `Report ${index}` }),
    )
    api.state.feedback = filler
    server.use(...api.handlers)
    renderAt(`/console/tickets?ticket=${crypto.randomUUID()}`, routes)
    expect(await screen.findByText('Feedback not found.')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Report 29')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Assigned · 1' }))
    expect(await screen.findByText('No tickets here.')).toBeInTheDocument()
  })

  it('shows a fact ticket with no task, and a failed task lookup', async () => {
    const { api } = world()
    const untasked = feedbackItem({ target_type: 'fact', target_id: api.state.facts[1]?.id as string, message: 'Odd.' })
    api.state.feedback.push(untasked)
    server.use(...api.handlers)
    renderAt(`/console/tickets?ticket=${untasked.id}`, routes)
    const task = async () => (await within(detail()).findByText('Task')).nextElementSibling as HTMLElement
    await waitFor(async () => expect(await task()).toHaveTextContent('—'))
    expect(within(detail()).getByText('光')).toBeInTheDocument()

    server.use(http.get('/manage/v1/work/items', () => apiError(403, 'forbidden', 'Tasks are hidden.')))
    renderAt(`/console/tickets?ticket=${untasked.id}`, [{ path: '/console/tickets', element: <TicketsBrowser /> }])
    expect(await screen.findByText('Tasks are hidden.')).toBeInTheDocument()
  })

  it('surfaces a failed list', async () => {
    server.use(http.get('/manage/v1/feedback', () => apiError(403, 'forbidden', 'Admins only.')))
    renderAt('/console/tickets', [{ path: '/console/tickets', element: <TicketsBrowser /> }])
    expect(await screen.findByRole('alert')).toHaveTextContent('Admins only.')
    expect(screen.getByRole('tab', { name: 'Open' })).toBeInTheDocument()
  })
})
