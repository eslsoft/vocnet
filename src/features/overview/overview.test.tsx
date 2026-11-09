import { fireEvent, screen, within } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiError, consoleApi, fact, feedbackItem } from '@/test/console-api'
import { server } from '@/test/msw'
import { renderAt } from '@/test/render'
import { Overview } from './index'

const routes = [{ path: '/', element: <Overview /> }]

describe('Overview', () => {
  it('counts facts by kind and status and links to them [spec: console/overview]', async () => {
    const example = (status: 'published' | 'pending') => fact({ kind: 'example', payload: { text: 'x' }, status })
    const target = { target_type: 'entry' as const, target_id: crypto.randomUUID() }
    const api = consoleApi({
      facts: [example('published'), example('published'), example('pending'), fact({ kind: 'entry', payload: {} })],
      feedback: [feedbackItem(target), feedbackItem({ ...target, status: 'resolved' })],
    })
    server.use(...api.handlers)
    const view = renderAt('/', routes)

    const row = (await screen.findByRole('cell', { name: 'Example' })).closest('tr') as HTMLElement
    expect(within(row).getByRole('link', { name: '2' })).toHaveAttribute('href', '/facts?kind=example&status=published')
    expect(within(row).getByRole('link', { name: '1' })).toHaveAttribute('href', '/facts?kind=example&status=pending')
    expect(within(row).getByRole('link', { name: '3' })).toHaveAttribute('href', '/facts?kind=example')
    const totals = screen.getByRole('cell', { name: 'Total' }).closest('tr') as HTMLElement
    expect(within(totals).getByRole('link', { name: '3' })).toHaveAttribute('href', '/facts?status=published')
    expect(within(totals).getByText('4')).toBeInTheDocument()

    fireEvent.click(within(row).getByRole('link', { name: '3' }))
    expect(view.location()).toBe('/facts?kind=example')
  })

  it('links the open feedback count', async () => {
    const target = { target_type: 'entry' as const, target_id: crypto.randomUUID() }
    server.use(...consoleApi({ feedback: [feedbackItem(target)] }).handlers)
    renderAt('/', routes)
    expect(await screen.findByText('Open feedback')).toBeInTheDocument()
    const link = screen
      .getAllByRole('link')
      .find((candidate) => candidate.getAttribute('href') === '/feedback?status=open')
    expect(link).toHaveTextContent('1')
  })

  it('shows why a non-admin sees nothing [spec: console/forbidden]', async () => {
    server.use(http.get('/manage/v1/stats', () => apiError(403, 'forbidden', 'Only admins may use this token.')))
    renderAt('/', routes)
    expect(await screen.findByRole('alert')).toHaveTextContent('Only admins may use this token.')
  })
})
