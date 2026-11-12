import { fireEvent, screen, within } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiError, consoleApi, consoleStats, fromNow, workSummary } from '@/test/console-api'
import { server } from '@/test/msw'
import { renderAt } from '@/test/render'
import { Overview } from './index'

const routes = [{ path: '/console', element: <Overview /> }]

const stats = consoleStats({
  facts: [
    { kind: 'example', status: 'published', count: 16_000 },
    { kind: 'example', status: 'pending', count: 380 },
    { kind: 'example', status: 'rejected', count: 220 },
    { kind: 'senses', status: 'published', count: 9_000 },
    { kind: 'senses', status: 'superseded', count: 10 },
  ],
  low_credibility: [{ kind: 'example', count: 141 }],
  live_facts: 25_380,
  completeness: {
    average: 0.724,
    by_level: [
      { level: null, entries: 2_302, complete: 12, average: 0.04 },
      { level: 'A1', entries: 1_042, complete: 812, average: 0.912 },
    ],
  },
  pending_review: { count: 1_204, oldest_at: fromNow(-(3 * 3600 + 12 * 60)), over_one_hour: 94 },
  tickets: { open: 5, resolved: 9, dismissed: 1 },
  work: { open: 18_442, stuck: 37, timed_out_24h: 12 },
})

const summary = workSummary({
  forecast: {
    net_per_day: 1_690,
    net_per_day_24h: 1_500,
    by_level: [
      { level: 'A1', open: 412, net_per_day: 390 },
      { level: 'B1', open: 4_210, net_per_day: 420 },
    ],
  },
})

describe('Overview', () => {
  it('shows completeness, credibility, open tasks, and pending review at a glance [spec: console/overview]', async () => {
    server.use(...consoleApi({ stats, summary }).handlers)
    renderAt('/console', routes)

    const completeness = await screen.findByRole('region', { name: 'Completeness' })
    expect(within(completeness).getByText('72.4%')).toBeInTheDocument()
    expect(within(completeness).getByText('Average across 3,344 entries')).toBeInTheDocument()
    const credibility = screen.getByRole('region', { name: 'Credibility' })
    expect(within(credibility).getByText('99.4%')).toBeInTheDocument()
    expect(
      within(credibility).getByText('141 of 25,380 live facts settled by a review path right less than 9 times in 10'),
    ).toBeInTheDocument()
    const open = screen.getByRole('region', { name: 'Open tasks' })
    expect(within(open).getByText('18,442')).toBeInTheDocument()
    expect(await within(open).findByText('A1 done in ~1 day')).toBeInTheDocument()
    expect(within(open).getByText('Net -1,690 a day · all done in ~11 days')).toBeInTheDocument()
    const pending = screen.getByRole('region', { name: 'Facts pending review' })
    expect(within(pending).getByText('Over 1 hour')).toBeInTheDocument()
    expect(within(pending).getByText('The oldest has waited 3h 12m')).toBeInTheDocument()

    const levels = screen.getByText('Completeness by CEFR level').closest('[data-slot=card]') as HTMLElement
    const rows = within(levels).getAllByRole('listitem')
    expect(rows.map((row) => row.firstChild?.textContent)).toEqual(['A1', 'No CEFR level'])
    expect(within(rows[0] as HTMLElement).getByText('812 / 1,042 complete')).toBeInTheDocument()
  })

  it('links each thing needing attention to the filtered page [spec: console/needs-attention]', async () => {
    server.use(...consoleApi({ stats, summary }).handlers)
    const view = renderAt('/console', routes)
    const link = async (name: RegExp) => screen.findByRole('link', { name })
    expect(await link(/Low-credibility facts\s*141/)).toHaveAttribute('href', '/console/tickets?type=audit')
    expect(await link(/Stuck tasks\s*37/)).toHaveAttribute('href', '/console/tickets?type=stuck_work')
    expect(await link(/Open tickets\s*5/)).toHaveAttribute('href', '/console/tickets')
    expect(await link(/timed out \(24h\)\s*12/)).toHaveAttribute('href', '/console/tasks')
    expect(await link(/over 1 hour\s*94/)).toHaveAttribute('href', '/console/facts?status=pending')
    fireEvent.click(await link(/Low-credibility facts/))
    expect(view.location()).toBe('/console/tickets?type=audit')
  })

  it('splits facts by type into linked status segments [spec: console/facts-by-type]', async () => {
    server.use(...consoleApi({ stats, summary }).handlers)
    renderAt('/console', routes)
    const example = (await screen.findByRole('cell', { name: 'Example' })).closest('tr') as HTMLElement
    expect(
      within(example)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Example', '', '141', '380', '16,600'])
    expect(within(example).getByRole('link', { name: 'Example: 15,859 Published' })).toHaveAttribute(
      'href',
      '/console/facts?kind=example&status=published',
    )
    expect(within(example).getByRole('link', { name: 'Example: 141 Low credibility' })).toHaveAttribute(
      'href',
      '/console/facts?kind=example&status=published',
    )
    expect(within(example).getByRole('link', { name: 'Example: 220 Rejected' })).toHaveAttribute(
      'href',
      '/console/facts?kind=example&status=rejected',
    )
    const sense = screen.getByRole('cell', { name: 'Sense inventory' }).closest('tr') as HTMLElement
    expect(within(sense).queryByRole('link', { name: /Pending/ })).not.toBeInTheDocument()
  })

  it('says when nothing waits and the queue is growing', async () => {
    const quiet = consoleStats({ work: { open: 10, stuck: 0, timed_out_24h: 0 } })
    const growing = workSummary({
      forecast: { net_per_day: -2, net_per_day_24h: -1, by_level: [{ level: 'A1', open: 5, net_per_day: -1 }] },
    })
    server.use(...consoleApi({ stats: quiet, summary: growing }).handlers)
    renderAt('/console', routes)
    expect(await screen.findByText('Nothing is waiting for review.')).toBeInTheDocument()
    expect(screen.queryByText('Over 1 hour')).not.toBeInTheDocument()
    expect(await screen.findByText('A1 growing')).toBeInTheDocument()
    expect(screen.getByText('Net +2 a day · not shrinking yet')).toBeInTheDocument()
    expect(screen.getByText('100.0%')).toBeInTheDocument()
  })

  it('waits for a day of history before forecasting the open tasks', async () => {
    const young = workSummary({
      history_since: new Date().toISOString(),
      forecast: { net_per_day: null, net_per_day_24h: null, by_level: [{ level: 'A1', open: 5, net_per_day: null }] },
    })
    server.use(...consoleApi({ stats, summary: young }).handlers)
    renderAt('/console', routes)
    const open = await screen.findByRole('region', { name: 'Open tasks' })
    expect(await within(open).findByText('Forecast after a day of history')).toBeInTheDocument()
    expect(within(open).queryByText(/^A1 /)).not.toBeInTheDocument()
  })

  it('shows a failed forecast inside its card', async () => {
    server.use(...consoleApi({ stats }).handlers)
    server.use(http.get('/manage/v1/work/summary', () => apiError(403, 'forbidden', 'Summary is down.')))
    renderAt('/console', routes)
    const open = await screen.findByRole('region', { name: 'Open tasks' })
    expect(await within(open).findByRole('alert')).toHaveTextContent('Summary is down.')
  })

  it('shows why a non-admin sees nothing, without retrying [spec: console/forbidden]', async () => {
    let requests = 0
    server.use(
      http.get('/manage/v1/stats', () => {
        requests += 1
        return apiError(403, 'forbidden', 'Only admins may use this token.')
      }),
    )
    renderAt('/console', routes)
    expect(await screen.findByRole('alert')).toHaveTextContent('Only admins may use this token.')
    expect(requests).toBe(1)
  })
})
