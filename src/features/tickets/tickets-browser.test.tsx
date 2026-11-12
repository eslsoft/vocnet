import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiError, consoleApi, fact, review, ticket, workTask } from '@/test/console-api'
import { server } from '@/test/msw'
import { renderAt } from '@/test/render'
import { chooseOption } from '@/test/select'
import { TicketsBrowser } from './index'

const counts = { open: 5, resolved: 7, dismissed: 2 }
const routes = [{ path: '/console/tickets', element: <TicketsBrowser counts={counts} /> }]

function world() {
  const light = { id: crypto.randomUUID(), lemma: 'light' }
  const bank = { id: crypto.randomUUID(), lemma: 'bank' }
  const sense = { id: crypto.randomUUID(), entry_id: light.id, pos: 'noun' as const }
  const translation = fact({
    kind: 'translation',
    payload: { language: 'zh', of: 'sense', text: '轻的' },
    subject_id: sense.id,
    review: review({ verdict: 'fail', confidence: 0.2 }),
  })
  const correction = fact({
    kind: 'translation',
    payload: { language: 'zh', of: 'sense', text: '光' },
    subject_id: sense.id,
  })
  const aboutFact = ticket({
    type: 'feedback',
    target_type: 'fact',
    target: translation.id,
    message: '“轻的” sits under the noun sense.',
    created_at: '2026-11-10T18:42:00.000Z',
  })
  const stuck = ticket({
    type: 'stuck_work',
    target_type: 'sense',
    target: sense.id,
    message: 'Two passes found no example a learner would read.',
  })
  const missing = ticket({
    type: 'missing_word',
    target_type: 'lemma',
    target: 'lamplight',
    message: 'Needed as a part.',
  })
  const resolved = ticket({
    type: 'audit',
    target_type: 'entry',
    target: bank.id,
    message: 'Missing plural.',
    status: 'resolved',
    resolution_note: 'Added the plural.',
    resolution_fact_ids: [correction.id],
    created_at: '2026-11-03T00:00:00.000Z',
  })
  const dismissed = ticket({
    type: 'feedback',
    target_type: 'entry',
    target: bank.id,
    message: 'Not a real problem.',
    status: 'dismissed',
    resolution_note: 'The entry is right.',
  })
  const task = workTask({
    entry: light as never,
    subject_id: sense.id,
    gap: { type: 'examples', sense_id: sense.id as never, count: 0, need: 1 },
    status: 'stuck',
    attempts_without_progress: 2,
  })
  const api = consoleApi({
    entries: [light, bank],
    senses: [sense],
    facts: [translation, correction],
    tickets: [aboutFact, stuck, missing, resolved, dismissed],
    tasks: [task],
  })
  return { api, aboutFact, stuck, missing, resolved, correction, task, light }
}

const detail = () => screen.getByRole('region', { name: 'Ticket detail' })

describe('TicketsBrowser', () => {
  it('lists tickets by tab and type and shows one with what it is about [spec: console/tickets]', async () => {
    const { api, aboutFact } = world()
    server.use(...api.handlers)
    const view = renderAt('/console/tickets', routes)

    expect(screen.getByRole('tab', { name: 'Open · 5' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Open · 5',
      'Resolved · 7',
      'Dismissed · 2',
      'All · 14',
    ])
    const row = (await screen.findByText('“轻的” sits under the noun sense.')).closest('button') as HTMLElement
    expect(within(row).getByText('light')).toBeInTheDocument()
    expect(within(row).getByText('Feedback')).toBeInTheDocument()
    const lemmaRow = screen.getByText('Needed as a part.').closest('button') as HTMLElement
    expect(within(lemmaRow).getByText('lamplight')).toBeInTheDocument()
    expect(screen.queryByText('Missing plural.')).not.toBeInTheDocument()

    await chooseOption('Type', 'Stuck work')
    await waitFor(() => expect(view.location()).toBe('/console/tickets?type=stuck_work'))
    await waitFor(() => expect(screen.queryByText('Needed as a part.')).not.toBeInTheDocument())
    expect(screen.getByText('Two passes found no example a learner would read.')).toBeInTheDocument()
    await chooseOption('Type', 'All')

    fireEvent.click(await screen.findByText('“轻的” sits under the noun sense.'))
    await waitFor(() => expect(view.location()).toBe(`/console/tickets?ticket=${aboutFact.id}`))
    expect(await within(detail()).findByRole('heading', { name: 'light' })).toBeInTheDocument()
    expect(within(detail()).getByText('About this fact')).toBeInTheDocument()
    expect(await within(detail()).findByText('轻的')).toBeInTheDocument()
    expect(within(detail()).getByText('Published')).toBeInTheDocument()
    expect(within(detail()).getByText('Review failed')).toBeInTheDocument()
    expect(within(detail()).getByRole('link', { name: 'Open entry' })).toHaveAttribute('href', '/console/entries/light')
    expect(within(detail()).queryByText('Open tasks')).not.toBeInTheDocument()
  })

  it('shows a missing word without an entry, and a closed ticket with its fixes [spec: console/tickets]', async () => {
    const { api, missing, resolved, correction } = world()
    server.use(...api.handlers)
    const view = renderAt(`/console/tickets?ticket=${missing.id}`, routes)
    expect(await within(detail()).findByRole('heading', { name: 'lamplight' })).toBeInTheDocument()
    expect(within(detail()).getByText('About this missing word')).toBeInTheDocument()
    expect(within(detail()).queryByRole('link', { name: 'Open entry' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Resolved · 7' }))
    await waitFor(() => expect(view.location()).toContain('tab=resolved'))
    fireEvent.click(await screen.findByText('Missing plural.'))
    expect(await within(detail()).findByText('About this entry')).toBeInTheDocument()
    expect(within(detail()).getByText('Audit')).toBeInTheDocument()
    expect(within(detail()).getByText('Added the plural.')).toBeInTheDocument()
    expect(within(detail()).getByRole('link', { name: correction.id })).toHaveAttribute(
      'href',
      `/console/facts?fact=${correction.id}`,
    )
    expect(within(detail()).queryByRole('button', { name: 'Resolve…' })).not.toBeInTheDocument()
    expect(resolved.status).toBe('resolved')

    fireEvent.click(screen.getByRole('tab', { name: 'Dismissed · 2' }))
    expect(await screen.findByText('Not a real problem.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'All · 14' }))
    expect(await screen.findByText('Missing plural.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Open · 5' }))
    await waitFor(() => expect(view.location()).not.toContain('tab='))
  })

  it('resolves a ticket with the facts that fixed it, and dismisses another [spec: console/tickets]', async () => {
    const { api, aboutFact, missing, correction } = world()
    server.use(...api.handlers)
    renderAt(`/console/tickets?ticket=${aboutFact.id}`, routes)

    fireEvent.click(await within(detail()).findByRole('button', { name: 'Resolve…' }))
    let dialog = await screen.findByRole('dialog', { name: 'Close this ticket' })
    expect(within(dialog).getByRole('button', { name: 'Resolve' })).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Resolution note'), { target: { value: 'Replaced the gloss.' } })
    fireEvent.change(within(dialog).getByLabelText('Fact ids that fixed it (resolve only)'), {
      target: { value: 'not-an-id' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }))
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    expect(api.state.tickets.find((item) => item.id === aboutFact.id)?.status).toBe('open')

    fireEvent.change(within(dialog).getByLabelText('Fact ids that fixed it (resolve only)'), {
      target: { value: `${correction.id}\n` },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.state.tickets.find((item) => item.id === aboutFact.id)).toMatchObject({
      status: 'resolved',
      resolution_note: 'Replaced the gloss.',
      resolution_fact_ids: [correction.id],
    })
    expect(await within(detail()).findByText('Resolved')).toBeInTheDocument()
    expect(within(detail()).queryByRole('button', { name: 'Resolve…' })).not.toBeInTheDocument()

    cleanup()
    renderAt(`/console/tickets?ticket=${missing.id}`, routes)
    fireEvent.click(await within(detail()).findByRole('button', { name: 'Resolve…' }))
    dialog = await screen.findByRole('dialog', { name: 'Close this ticket' })
    fireEvent.change(within(dialog).getByLabelText('Resolution note'), { target: { value: 'Not a headword.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() =>
      expect(api.state.tickets.find((item) => item.id === missing.id)).toMatchObject({
        status: 'dismissed',
        resolution_note: 'Not a headword.',
        resolution_fact_ids: [],
      }),
    )
  })

  it('shows a refused resolution where the curator acted', async () => {
    const { api, aboutFact } = world()
    server.use(...api.handlers)
    server.use(http.post('/manage/v1/tickets/:id/resolve', () => apiError(409, 'conflict', 'Already resolved.')))
    renderAt(`/console/tickets?ticket=${aboutFact.id}`, routes)
    fireEvent.click(await within(detail()).findByRole('button', { name: 'Resolve…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Close this ticket' })
    fireEvent.change(within(dialog).getByLabelText('Resolution note'), { target: { value: 'Fixed.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Already resolved.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('settles the slot of stuck work from its ticket [spec: console/tickets]', async () => {
    const { api, stuck, task, light } = world()
    server.use(...api.handlers)
    renderAt(`/console/tickets?ticket=${stuck.id}`, routes)
    expect(await within(detail()).findByText('About this sense')).toBeInTheDocument()
    const tasks = (await within(detail()).findByText('Examples')).closest('li') as HTMLElement
    expect(within(tasks).getByText('Has 0 examples. This sense needs 1.')).toBeInTheDocument()
    expect(within(tasks).getByText('Stuck')).toBeInTheDocument()
    expect(within(tasks).getByRole('link', { name: /Examples/ })).toHaveAttribute(
      'href',
      `/console/tasks/activity?task=${task.id}`,
    )
    fireEvent.click(within(tasks).getByRole('button', { name: 'Settle' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settle Examples for light' })
    fireEvent.change(within(dialog).getByLabelText('Why nothing fills it'), { target: { value: 'No example fits.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Settle slot' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await within(detail()).findByText('No open tasks.')).toBeInTheDocument()
    expect(api.state.passes).toEqual([
      { entry_id: light.id, type: 'examples', subject_id: task.subject_id, note: 'No example fits.' },
    ])
  })

  it('says when a tab is empty, pages through it, and shows a missing ticket', async () => {
    const { api } = world()
    api.state.tickets = Array.from({ length: 30 }, (_, index) =>
      ticket({
        type: 'feedback',
        target_type: 'entry',
        target: api.state.entries[1]?.id as string,
        message: `Report ${index}`,
      }),
    )
    server.use(...api.handlers)
    renderAt(`/console/tickets?ticket=${crypto.randomUUID()}`, routes)
    expect(await screen.findByText('Ticket not found.')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Report 29')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Dismissed · 2' }))
    expect(await screen.findByText('No tickets here.')).toBeInTheDocument()
  })

  it('shows a failed fact lookup and a failed task lookup', async () => {
    const { api, aboutFact, stuck } = world()
    server.use(...api.handlers)
    server.use(http.get('/manage/v1/facts/:id', () => apiError(403, 'forbidden', 'Facts are hidden.')))
    server.use(http.get('/manage/v1/work/items', () => apiError(403, 'forbidden', 'Tasks are hidden.')))
    renderAt(`/console/tickets?ticket=${aboutFact.id}`, routes)
    expect(await within(detail()).findByText('Facts are hidden.')).toBeInTheDocument()
    cleanup()
    renderAt(`/console/tickets?ticket=${stuck.id}`, routes)
    expect(await within(detail()).findByText('Tasks are hidden.')).toBeInTheDocument()
  })

  it('surfaces a failed list', async () => {
    server.use(http.get('/manage/v1/tickets', () => apiError(403, 'forbidden', 'Admins only.')))
    renderAt('/console/tickets', [{ path: '/console/tickets', element: <TicketsBrowser /> }])
    expect(await screen.findByRole('alert')).toHaveTextContent('Admins only.')
    expect(screen.getByRole('tab', { name: 'Open' })).toBeInTheDocument()
  })
})
