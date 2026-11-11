import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { agent, consoleApi, fromNow, workSummary } from '@/test/console-api'
import { server } from '@/test/msw'
import { renderAt } from '@/test/render'
import { chooseOption } from '@/test/select'
import { HEAVY_TEST_MS } from '@/test/timeouts'
import { TasksHeader, TasksQueue } from './index'

function Page() {
  return (
    <>
      <TasksHeader view="queue" />
      <TasksQueue />
    </>
  )
}

const routes = [
  { path: '/console/tasks', element: <Page /> },
  { path: '/console/tasks/activity', element: <TasksHeader view="activity" /> },
]

const producer = agent({ name: 'producer-a1' })

const summary = workSummary({
  open: { queued: 15_000, in_progress: 214, waiting_on_review: 2_211, stuck: 37, total: 18_442 },
  created: 1_200,
  closed: 2_928,
  median_close_seconds: 6 * 3600 + 40 * 60,
  agents: 6,
  by_type: [
    {
      type: 'examples',
      stage: 4,
      open: 3_980,
      waiting_on_review: 520,
      stuck: 2,
      closed: 640,
      median_attempt_seconds: 90,
      success_rate: 0.84,
    },
    {
      type: 'senses',
      stage: 1,
      open: 2_302,
      waiting_on_review: 140,
      stuck: 3,
      closed: 96,
      median_attempt_seconds: 250,
      success_rate: 0.68,
    },
    {
      type: 'phrases',
      stage: 2,
      open: 186,
      waiting_on_review: 14,
      stuck: 0,
      closed: 0,
      median_attempt_seconds: null,
      success_rate: 0.52,
    },
    {
      type: 'weak_fact',
      stage: 5,
      open: 386,
      waiting_on_review: 0,
      stuck: 0,
      closed: 0,
      median_attempt_seconds: null,
      success_rate: null,
    },
  ],
  throughput: [
    { start: '2026-11-10T22:00:00.000Z', created: 50, closed: 120 },
    { start: '2026-11-10T23:00:00.000Z', created: 40, closed: 100 },
  ],
  forecast: {
    net_per_day: 1_690,
    net_per_day_24h: 1_400,
    by_level: [
      { level: null, open: 1_670, net_per_day: -30 },
      { level: 'A2', open: 1_880, net_per_day: 610 },
      { level: 'A1', open: 412, net_per_day: 390 },
      { level: 'B2', open: 5_960, net_per_day: 240 },
      { level: 'C1', open: 4_310, net_per_day: 60 },
      { level: 'C2', open: 0, net_per_day: 0 },
    ],
  },
  leases: [
    {
      id: crypto.randomUUID() as never,
      holder: `agent:${producer.id}`,
      type: 'examples',
      items: 10,
      lemmas: ['run', 'bank', 'light'],
      claimed_at: fromNow(-180),
      expires_at: fromNow(720),
      timed_out: false,
    },
    {
      id: crypto.randomUUID() as never,
      holder: 'agent:reviser',
      type: 'weak_fact',
      items: 2,
      lemmas: ['get', 'play'],
      claimed_at: fromNow(-3000),
      expires_at: fromNow(-600),
      timed_out: true,
    },
  ],
})

describe('TasksQueue', () => {
  it('shows open work, throughput, forecast, types by stage, and who works on what [spec: console/task-queue]', async () => {
    server.use(...consoleApi({ summary, agents: [producer] }).handlers)
    renderAt('/console/tasks', routes)

    const open = await screen.findByRole('region', { name: 'Open tasks' })
    expect(within(open).getByText('18,442')).toBeInTheDocument()
    expect(within(open).getByText('+1,200')).toBeInTheDocument()
    expect(within(open).getByText('1,200 created in the last 24h')).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'In progress' })).getByText('6 agents working now'),
    ).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Stuck' })).getByText('37')).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Closed' })).getByText('Median 6h 40m to close'),
    ).toBeInTheDocument()

    const throughput = screen.getByText('Throughput').closest('[data-slot=card]') as HTMLElement
    expect(within(throughput).getByText('122')).toBeInTheDocument()
    expect(within(throughput).getByText('-72')).toBeInTheDocument()
    expect(within(throughput).getByText('20.3')).toBeInTheDocument()
    expect(
      within(throughput).getByRole('img', { name: '2928 tasks closed and 1200 created in this window' }),
    ).toBeVisible()

    const forecast = screen.getByText('Forecast').closest('[data-slot=card]') as HTMLElement
    expect(within(forecast).getByText('~11 days')).toBeInTheDocument()
    const levels = within(forecast)
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      )
    expect(levels).toEqual([
      ['A1', '412', '-390', '~1 day'],
      ['A2', '1,880', '-610', '~3 days'],
      ['B2', '5,960', '-240', '~25 days'],
      ['C1', '4,310', '-60', '~72 days'],
      ['C2', '0', '0', 'Done'],
      ['No level', '1,670', '+30', 'Growing'],
    ])

    const groups = screen.getAllByRole('columnheader').filter((cell) => cell.getAttribute('scope') === 'colgroup')
    expect(groups.map((cell) => cell.textContent)).toEqual(['Senses', 'Word relations', 'Usage', 'Fixes'])
    const examples = screen.getByRole('cell', { name: 'Examples' }).closest('tr') as HTMLElement
    expect(
      within(examples)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Examples', '3,980', '520', '2', '640', '1m 30s', '84%'])
    const phrases = screen.getByRole('cell', { name: 'Phrasal verbs' }).closest('tr') as HTMLElement
    expect(within(phrases).getByText('52%')).toHaveClass('text-warning-foreground')
    expect(within(phrases).getAllByText('—')).toHaveLength(1)

    const leases = screen.getByText('Which agent is working on what.').closest('[data-slot=card]') as HTMLElement
    const [first, second] = within(leases).getAllByRole('listitem') as HTMLElement[]
    expect(await within(first as HTMLElement).findByText('producer-a1')).toBeInTheDocument()
    expect(within(first as HTMLElement).getByText(/^1[12]m( \d\ds)? left$/)).toBeInTheDocument()
    expect(first).toHaveTextContent('10 tasks · run, bank, light…')
    expect(within(second as HTMLElement).getByText('agent:reviser')).toBeInTheDocument()
    expect(within(second as HTMLElement).getByText('Timed out')).toBeInTheDocument()
    expect(second).toHaveTextContent('2 tasks · get, play')
  })

  it('collects history before it forecasts or rates the throughput [spec: console/task-queue]', async () => {
    const collecting = { net_per_day: null, net_per_day_24h: null, by_level: [] }
    server.use(
      ...consoleApi({
        summary: workSummary({ history_since: '2026-11-11T01:00:00.000Z', forecast: collecting }),
      }).handlers,
    )
    const view = renderAt('/console/tasks', routes)
    const forecast = (await screen.findByText('Forecast')).closest('[data-slot=card]') as HTMLElement
    expect(await within(forecast).findByText('Collecting history')).toBeInTheDocument()
    expect(
      within(forecast).getByText(/^Recording since .+\. Forecasts appear once a full day is recorded\.$/),
    ).toBeInTheDocument()
    expect(within(forecast).queryByRole('table')).not.toBeInTheDocument()
    view.unmount()

    server.use(...consoleApi({ summary: workSummary({ history_since: null, forecast: collecting }) }).handlers)
    renderAt('/console/tasks', routes)
    expect(
      await screen.findByText('Nothing recorded yet. Forecasts appear once a full day is recorded.'),
    ).toBeInTheDocument()
    const throughput = screen.getByText('Throughput').closest('[data-slot=card]') as HTMLElement
    expect(within(throughput).getAllByText('—')).toHaveLength(4)
  })

  it(
    'switches the window in the URL and between Queue and Activity [spec: console/task-queue]',
    async () => {
      const open = { queued: 5, in_progress: 0, waiting_on_review: 0, stuck: 0, total: 5 }
      server.use(...consoleApi({ summary: workSummary({ open }) }).handlers)
      const view = renderAt('/console/tasks', routes)
      expect(await screen.findByText('No agent is working right now.')).toBeInTheDocument()
      expect(screen.getByText('None closed in this window')).toBeInTheDocument()
      expect(screen.getByText('Growing', { selector: 'span.font-semibold' })).toBeInTheDocument()

      await chooseOption('Window', 'Last 7 days')
      await waitFor(() => expect(view.location()).toBe('/console/tasks?window=7d'))
      expect(await screen.findByText('Tasks closed and created per day, last 7 days.')).toBeInTheDocument()
      await chooseOption('Window', 'Last 24 hours')
      await waitFor(() => expect(view.location()).toBe('/console/tasks'))

      screen.getByRole('link', { name: 'Activity' }).click()
      await waitFor(() => expect(view.location()).toBe('/console/tasks/activity'))
      await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Window' })).not.toBeInTheDocument())
    },
    HEAVY_TEST_MS,
  )
})
