import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThemeProvider } from '@/shared/theme/provider'
import { consoleApi, consoleStats } from '@/test/console-api'
import { server } from '@/test/msw'
import { renderAt } from '@/test/render'
import { ConsoleLayout } from './console-layout'

const routes = [
  {
    path: '/console',
    element: (
      <ThemeProvider>
        <ConsoleLayout />
      </ThemeProvider>
    ),
  },
]

describe('ConsoleLayout', () => {
  it('lists the pages with what needs a look beside each, and the public resources [spec: console/navigation]', async () => {
    const stats = consoleStats({
      flagged: [
        { kind: 'example', count: 300 },
        { kind: 'sense', count: 86 },
      ],
      completeness: {
        average: 0.7,
        by_level: [
          { level: 'A1', entries: 10_000, complete: 1, average: 0.9 },
          { level: null, entries: 2_408, complete: 1, average: 0.1 },
        ],
      },
      feedback: { open: 5, claimed: 2, resolved: 9, dismissed: 1 },
      work: { open: 100, stuck: 37, timed_out_24h: 0 },
    })
    server.use(...consoleApi({ stats }).handlers)
    renderAt('/console', routes)

    const nav = screen.getByRole('navigation', { name: 'Console' })
    const link = (name: RegExp) => within(nav).getByRole('link', { name })
    expect(await within(nav).findByText('12,408')).toBeInTheDocument()
    expect(link(/^Entries/)).toHaveAttribute('href', '/console/entries')
    expect(within(link(/^Facts/)).getByText('386 flagged')).toHaveClass('text-warning-foreground')
    expect(link(/^Tickets/)).toHaveTextContent('5 open')
    expect(within(link(/^Tasks/)).getByText('37 stuck')).toHaveClass('text-destructive')
    expect(link(/^API Keys/)).toHaveAttribute('href', '/console/keys')
    expect(link(/^Overview/)).toHaveAttribute('aria-current', 'page')
    expect(within(nav).queryByRole('link', { name: /About|Feedback|Agents/ })).not.toBeInTheDocument()

    const resources = screen.getByRole('navigation', { name: 'Resources' })
    expect(within(resources).getByRole('link', { name: 'Public dictionary' })).toHaveAttribute('href', '/')
    expect(within(resources).getByRole('link', { name: 'Developer guide' })).toHaveAttribute('href', '/developers')
    expect(within(resources).getByRole('link', { name: 'API reference' })).toHaveAttribute('href', '/docs')
    expect(screen.getByText('Administrator')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()

    const menu = screen.getByRole('button', { name: 'Menu' })
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(link(/^Tickets/))
    expect(menu).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps calm counts when nothing is stuck', async () => {
    server.use(...consoleApi({ stats: consoleStats() }).handlers)
    renderAt('/console', routes)
    const tasks = await screen.findByText('0 stuck')
    expect(tasks).toHaveClass('text-muted-foreground')
  })
})
