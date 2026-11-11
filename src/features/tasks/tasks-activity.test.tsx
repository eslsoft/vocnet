import type { WorkItemId } from '@shared/work'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { agent, apiError, attempt, consoleApi, fact, fromNow, workTask } from '@/test/console-api'
import { server } from '@/test/msw'
import { renderAt } from '@/test/render'
import { chooseOption } from '@/test/select'
import { HEAVY_TEST_MS } from '@/test/timeouts'
import { SubjectTasks, TasksActivity } from './index'

const routes = [{ path: '/console/tasks/activity', element: <TasksActivity /> }]

const producer = agent({ name: 'producer-a1' })
const run = { id: crypto.randomUUID() as never, lemma: 'run' }
const bank = { id: crypto.randomUUID() as never, lemma: 'bank' }
const senseId = crypto.randomUUID()
const example = fact({ kind: 'example', payload: { text: 'She runs a small bakery downtown.' } })

const task = workTask({
  entry: run,
  subject_id: senseId,
  sense_gloss: 'be in charge of; manage',
  gap: { type: 'examples', sense_id: senseId as never, count: 1, need: 2 },
  status: 'waiting_on_review',
  attempts_without_progress: 1,
  lease: { holder: `agent:${producer.id}`, expires_at: fromNow(600) },
  agent_seconds: 432,
  queue_seconds: 100_800,
  attempts: [
    attempt({
      entry: run,
      attempt: 2,
      type: 'examples',
      holder: `agent:${producer.id}`,
      outcome: 'waiting_on_review',
      seconds: 192,
      note: 'Added a workplace example.',
      facts: [{ id: example.id, kind: 'example', status: 'pending', summary: 'She runs a small bakery downtown.' }],
    }),
    attempt({ entry: run, type: 'examples', holder: 'agent:producer-b', outcome: 'no_progress', seconds: 125 }),
  ],
})

function world() {
  const attempts = [
    attempt({
      entry: run,
      item_id: task.id,
      attempt: 2,
      type: 'examples',
      sense_gloss: 'be in charge of; manage',
      holder: `agent:${producer.id}`,
      outcome: 'waiting_on_review',
      seconds: 192,
      facts: [{ id: example.id, kind: 'example', status: 'pending', summary: 'x' }],
    }),
    attempt({ entry: bank, type: 'topics', outcome: 'stuck', seconds: 40 }),
    ...Array.from({ length: 25 }, (_, index) =>
      attempt({ entry: { id: crypto.randomUUID() as never, lemma: `word${index}` }, type: 'grammar' }),
    ),
  ]
  return consoleApi({ attempts, tasks: [task], agents: [producer] })
}

describe('TasksActivity', () => {
  it(
    'lists attempts newest first, filtered in the URL, page by page [spec: console/task-activity]',
    async () => {
      server.use(...world().handlers)
      const view = renderAt('/console/tasks/activity', routes)

      const row = (await screen.findByRole('button', { name: /^run/ })).closest('tr') as HTMLElement
      expect(
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent)
          .slice(1),
      ).toEqual(['producer-a1', '#2', 'runbe in charge of; manage', 'Examples', 'Waiting on review', '3m 12s', '1'])
      expect(screen.getByRole('columnheader', { name: 'Try' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^bank/ })).toHaveTextContent('whole entry')
      expect(screen.getAllByRole('row')).toHaveLength(26)
      fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
      expect(await screen.findByRole('button', { name: /^word24/ })).toBeInTheDocument()

      await chooseOption('Result', 'Stuck')
      await waitFor(() => expect(view.location()).toBe('/console/tasks/activity?result=stuck'))
      await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
      await chooseOption('Result', 'All')
      await chooseOption('Task', 'Topics')
      await chooseOption('Agent', 'producer-a1')
      expect(await screen.findByText('No attempts match these filters.')).toBeInTheDocument()
      expect(view.location()).toBe(`/console/tasks/activity?type=topics&agent=agent%3A${producer.id}`)

      fireEvent.change(screen.getByRole('searchbox', { name: 'Entry' }), { target: { value: 'run' } })
      await waitFor(() => expect(view.location()).toContain('entry=run'))
    },
    HEAVY_TEST_MS,
  )

  it('opens a task with its gap and every attempt, read-only [spec: console/task-detail]', async () => {
    server.use(...world().handlers)
    const view = renderAt('/console/tasks/activity', routes)
    fireEvent.click(await screen.findByRole('button', { name: /^run/ }))
    expect(view.location()).toBe(`/console/tasks/activity?task=${task.id}`)

    const sheet = await screen.findByRole('dialog')
    expect(await within(sheet).findByText('Task · Examples')).toBeInTheDocument()
    expect(within(sheet).getByText('run')).toBeInTheDocument()
    expect(within(sheet).getByText('be in charge of; manage')).toBeInTheDocument()
    expect(within(sheet).getByText('1 of 3 tries without progress')).toBeInTheDocument()
    expect(within(sheet).getByText('Has 1 example. This sense needs 2.')).toBeInTheDocument()
    expect(within(sheet).getByText(/producer-a1 is on it/)).toBeInTheDocument()
    expect(within(sheet).getByText('7m 12s')).toBeInTheDocument()
    expect(within(sheet).getByText('1d 4h')).toBeInTheDocument()
    const attempts = within(sheet)
      .getAllByRole('listitem')
      .filter((item) => item.textContent?.startsWith('#'))
    expect(attempts[0]).toHaveTextContent('#2producer-a1Waiting on review3m 12s')
    expect(within(attempts[0] as HTMLElement).getByText('Pending')).toBeInTheDocument()
    expect(attempts[0]).toHaveTextContent('Added a workplace example.')
    expect(attempts[1]).toHaveTextContent('#1agent:producer-bNo progress2m 05s')
    expect(attempts[1]).toHaveTextContent('Submitted no facts.')
    expect(within(sheet).getByText('Read-only. Agents pick up tasks through the API.')).toBeInTheDocument()
    expect(
      within(sheet)
        .queryAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Close'])

    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(view.location()).toBe('/console/tasks/activity'))
  })

  it('shows a task without attempts and a missing task', async () => {
    const fresh = workTask({ entry: bank, gap: { type: 'senses' }, stage: 1 })
    const api = world()
    api.state.tasks.push(fresh)
    server.use(...api.handlers)
    renderAt(`/console/tasks/activity?task=${fresh.id}`, routes)
    const sheet = await screen.findByRole('dialog')
    expect(await within(sheet).findByText('No attempts yet.')).toBeInTheDocument()
    expect(within(sheet).getByText('No senses yet.')).toBeInTheDocument()

    server.use(http.get('/manage/v1/work/items/:id', () => apiError(404, 'not_found', 'Work item not found.')))
    renderAt(`/console/tasks/activity?task=${crypto.randomUUID()}`, routes)
    expect(await screen.findByText('Work item not found.')).toBeInTheDocument()
  })

  it('surfaces a failed attempt list', async () => {
    server.use(...world().handlers)
    server.use(http.get('/manage/v1/work/attempts', () => apiError(403, 'forbidden', 'Admins only.')))
    renderAt('/console/tasks/activity', routes)
    expect(await screen.findByRole('alert')).toHaveTextContent('Admins only.')
  })
})

describe('SubjectTasks', () => {
  it('links the open task about a subject, or shows nothing without one', async () => {
    const flagged = workTask({
      entry: run,
      subject_id: example.id,
      stage: 5,
      gap: { type: 'weak_fact', fact_id: example.id, kind: 'example', reason: 'uncertain' },
    })
    server.use(...consoleApi({ tasks: [flagged] }).handlers)
    const routesFor = (subjectId: string) => [{ path: '/', element: <SubjectTasks subjectId={subjectId} /> }]
    renderAt('/', routesFor(example.id))
    const link = await screen.findByRole('link', { name: /Task · Fix flagged fact/ })
    expect(link).toHaveAttribute('href', `/console/tasks/activity?task=${flagged.id as WorkItemId}`)
    expect(link).toHaveTextContent('0 tries without progress')
    expect(link).toHaveTextContent('Queued')

    server.use(http.get('/manage/v1/work/items', () => apiError(403, 'forbidden', 'No tasks for you.')))
    renderAt('/', routesFor(crypto.randomUUID()))
    expect(await screen.findByRole('alert')).toHaveTextContent('No tasks for you.')
  })
})
