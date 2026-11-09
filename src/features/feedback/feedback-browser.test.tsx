import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { consoleApi, fact, feedbackItem } from '@/test/console-api'
import { server } from '@/test/msw'
import { renderAt } from '@/test/render'
import { FeedbackBrowser } from './index'

const routes = [{ path: '/feedback', element: <FeedbackBrowser /> }]

function world() {
  const bank = { id: crypto.randomUUID(), lemma: 'bank' }
  const gloss = fact({ kind: 'sense', payload: { gloss: 'a river side' } })
  const correction = fact({ kind: 'sense', payload: { gloss: 'land beside a river' } })
  const aboutFact = feedbackItem({ target_type: 'fact', target_id: gloss.id, message: 'Gloss is vague.' })
  const resolved = feedbackItem({
    target_type: 'entry',
    target_id: bank.id,
    message: 'Missing plural.',
    status: 'resolved',
    assignee: 'agent:fixer',
    resolution_note: 'Added the plural.',
    resolution_fact_ids: [correction.id],
  })
  const api = consoleApi({ entries: [bank], facts: [gloss, correction], feedback: [aboutFact, resolved] })
  return { api, gloss, correction, aboutFact, resolved }
}

describe('FeedbackBrowser', () => {
  it('filters by status and shows read-only detail with links [spec: console/feedback]', async () => {
    const { api, correction, resolved } = world()
    server.use(...api.handlers)
    const view = renderAt('/feedback', routes)

    expect(await screen.findByText('Gloss is vague.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'resolved' } })
    await waitFor(() => expect(screen.queryByText('Gloss is vague.')).not.toBeInTheDocument())

    fireEvent.click(await screen.findByRole('button', { name: 'Missing plural.' }))
    expect(view.location()).toBe(`/feedback?status=resolved&item=${resolved.id}`)
    const detail = screen.getByRole('dialog')
    expect(within(detail).getByText('agent:fixer')).toBeInTheDocument()
    expect(within(detail).getByText('Added the plural.')).toBeInTheDocument()
    expect(within(detail).getByText(/read-only/)).toBeInTheDocument()
    expect(within(detail).queryByRole('button', { name: /resolve|dismiss|claim/i })).not.toBeInTheDocument()
    expect(await within(detail).findByRole('link', { name: 'bank' })).toHaveAttribute('href', '/entries/bank')
    expect(within(detail).getByRole('link', { name: correction.id })).toHaveAttribute(
      'href',
      `/facts?fact=${correction.id}`,
    )

    fireEvent.click(within(detail).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(view.location()).toBe('/feedback?status=resolved'))
  })

  it('links fact feedback to the fact and pages through the list', async () => {
    const { api, gloss, aboutFact } = world()
    const filler = Array.from({ length: 25 }, (_, index) =>
      feedbackItem({ target_type: 'fact', target_id: gloss.id, message: `Report ${index}` }),
    )
    api.state.feedback = [...filler, aboutFact]
    server.use(...api.handlers)
    renderAt(`/feedback?item=${aboutFact.id}`, routes)

    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    const detail = await screen.findByRole('dialog')
    expect(within(detail).getByText('Gloss is vague.')).toBeInTheDocument()
    expect(within(detail).getByRole('link', { name: gloss.id })).toHaveAttribute('href', `/facts?fact=${gloss.id}`)
  })

  it('says when nothing has the chosen status', async () => {
    server.use(...world().api.handlers)
    renderAt('/feedback?status=dismissed', routes)
    expect(await screen.findByText('No feedback with this status.')).toBeInTheDocument()
  })
})
