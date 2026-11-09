import type { FactDto } from '@shared/facts'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiError, consoleApi, fact, review } from '@/test/console-api'
import { server } from '@/test/msw'
import { renderAt } from '@/test/render'
import { FactsBrowser } from './index'

const routes = [{ path: '/facts', element: <FactsBrowser /> }]

function example(text: string, overrides: Partial<FactDto> = {}) {
  return fact({ kind: 'example', payload: { text }, ...overrides } as FactDto)
}

function open(url: string, api: ReturnType<typeof consoleApi>) {
  server.use(...api.handlers)
  return renderAt(url, routes)
}

const drawer = () => screen.getByRole('dialog')

describe('FactsBrowser', () => {
  it('filters by status and kind and appends each page [spec: console/facts-browse]', async () => {
    const published = Array.from({ length: 30 }, (_, index) => example(`Example ${index}`))
    const pending = fact({ kind: 'sense', payload: { gloss: 'land beside a river' }, status: 'pending', review: null })
    const view = open('/facts', consoleApi({ facts: [pending, ...published] }))

    expect(await screen.findByText('land beside a river')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(26)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Example 29')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(32)
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'pending' } })
    expect(await screen.findByText('land beside a river')).toBeInTheDocument()
    expect(screen.queryByText('Example 0')).not.toBeInTheDocument()
    expect(screen.getByText('Not reviewed')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'example' } })
    expect(await screen.findByText('No facts match these filters.')).toBeInTheDocument()
    expect(view.location()).toBe('/facts?status=pending&kind=example')

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } })
    expect(await screen.findByText('Example 0')).toBeInTheDocument()
    expect(view.location()).toBe('/facts?kind=example')
  })

  it('ignores filter values outside the vocabulary', async () => {
    open('/facts?status=bogus', consoleApi({ facts: [example('Kept')] }))
    expect(await screen.findByText('Kept')).toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toHaveValue('')
  })

  it('marks uncertain and low-confidence facts as flagged [spec: console/flagged-facts]', async () => {
    open(
      '/facts',
      consoleApi({
        facts: [
          example('Sure', { review: review({ confidence: 0.95 }) }),
          example('Unsure', { review: review({ verdict: 'uncertain', confidence: 0.62 }) }),
          example('Weak pass', { review: review({ reviewer: 'llm', confidence: 0.55 }) }),
          example('Wrong', { status: 'rejected', review: review({ verdict: 'fail', confidence: 0.1 }) }),
        ],
      }),
    )
    const row = async (text: string) => (await screen.findByText(text)).closest('tr') as HTMLElement
    expect(within(await row('Sure')).getByText('Confident 95%')).toHaveAttribute('data-signal', 'confident')
    expect(within(await row('Unsure')).getByText('Uncertain 62%')).toHaveAttribute('data-signal', 'flagged')
    expect(within(await row('Weak pass')).getByText('Uncertain 55%')).toHaveAttribute('data-signal', 'flagged')
    expect(within(await row('Wrong')).getByText('Failed 10%')).toHaveAttribute('data-signal', 'failed')
    expect((await row('Unsure')).className).toContain('bg-amber')
    expect((await row('Weak pass')).className).toContain('bg-amber')
    expect((await row('Sure')).className).not.toContain('bg-amber')
  })

  it('shows payload, review, correction, and owning entry in the drawer [spec: console/fact-detail]', async () => {
    const entry = { id: crypto.randomUUID(), lemma: 'bank' }
    const sense = { id: crypto.randomUUID(), entry_id: entry.id, pos: 'noun' as const }
    const original = fact({
      kind: 'sense',
      payload: { gloss: 'a river side' },
      subject_id: sense.id,
      status: 'published',
    })
    const correction = fact({
      kind: 'sense',
      payload: { gloss: 'land beside a river' },
      subject_id: sense.id,
      supersedes_id: original.id,
      author: 'agent:fixer',
      review: review({ reason: 'An established meaning.' }),
    })
    const view = open(
      `/facts?fact=${correction.id}`,
      consoleApi({ entries: [entry], senses: [sense], facts: [original, correction] }),
    )

    expect(await within(drawer()).findByRole('heading', { name: 'Sense fact' })).toBeInTheDocument()
    expect(within(drawer()).getByText(/"gloss": "land beside a river"/)).toBeInTheDocument()
    expect(within(drawer()).getByText('agent:fixer')).toBeInTheDocument()
    expect(within(drawer()).getByText('jev · jev-latest')).toBeInTheDocument()
    expect(within(drawer()).getByText('Pass')).toBeInTheDocument()
    expect(within(drawer()).getByText('93%')).toBeInTheDocument()
    expect(within(drawer()).getByText('An established meaning.')).toBeInTheDocument()
    expect(await within(drawer()).findByRole('link', { name: 'bank' })).toHaveAttribute('href', '/entries/bank')

    fireEvent.click(within(drawer()).getByRole('button', { name: original.id }))
    expect(await within(drawer()).findByText('a river side')).toBeInTheDocument()
    expect(view.location()).toBe(`/facts?fact=${original.id}`)
  })

  it('opens a row in the drawer and closes it again', async () => {
    const pending = example('Fresh', { status: 'pending', review: null })
    const view = open('/facts', consoleApi({ facts: [pending] }))
    fireEvent.click(await screen.findByRole('button', { name: 'Fresh' }))
    expect(await within(drawer()).findByText('Not reviewed yet.')).toBeInTheDocument()
    expect(view.location()).toBe(`/facts?fact=${pending.id}`)
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(view.location()).toBe('/facts'))
  })

  it('retracts and re-reviews in place, offering only allowed moves [spec: console/fact-actions]', async () => {
    const published = example('Published one')
    const rejected = example('Rejected one', {
      status: 'rejected',
      review: review({ verdict: 'fail', confidence: 0.1 }),
    })
    const api = consoleApi({ facts: [published, rejected] })
    open(`/facts?fact=${published.id}`, api)

    fireEvent.click(await within(drawer()).findByRole('button', { name: 'Retract' }))
    await waitFor(() => expect(within(drawer()).getByText('Retracted')).toBeInTheDocument())
    expect(within(drawer()).getByRole('button', { name: 'Retract' })).toBeDisabled()
    expect(within(drawer()).getByRole('button', { name: 'Re-review' })).toBeDisabled()
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Close' }))
    const listed = (await screen.findByRole('button', { name: 'Published one' })).closest('tr') as HTMLElement
    expect(within(listed).getByText('Retracted')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Rejected one' }))
    expect(await within(drawer()).findByText('Rejected one')).toBeInTheDocument()
    expect(within(drawer()).getByRole('button', { name: 'Retract' })).toBeDisabled()
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Re-review' }))
    await waitFor(() => expect(within(drawer()).getByText('Pending')).toBeInTheDocument())
    expect(within(drawer()).getByRole('button', { name: 'Retract' })).toBeEnabled()
    expect(api.state.facts.map((candidate) => candidate.status)).toEqual(['retracted', 'pending'])
  })

  it('shows the server reason when an action is refused [spec: console/fact-action-error]', async () => {
    const published = example('Taken slot')
    open(`/facts?fact=${published.id}`, consoleApi({ facts: [published] }))
    server.use(
      http.post('/manage/v1/facts/:id/rereview', () =>
        apiError(409, 'conflict', 'Another live fact now holds this slot.'),
      ),
    )
    fireEvent.click(await within(drawer()).findByRole('button', { name: 'Re-review' }))
    expect(await within(drawer()).findByRole('alert')).toHaveTextContent('Another live fact now holds this slot.')
  })

  it('surfaces a missing fact and an unresolvable subject', async () => {
    const orphan = example('Orphan')
    open(`/facts?fact=${orphan.id}`, consoleApi({ facts: [orphan] }))
    expect(await within(drawer()).findByText('No entry or sense has this id.')).toBeInTheDocument()

    server.use(http.get('/manage/v1/facts/:id', () => apiError(404, 'not_found', 'Fact not found.')))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Orphan' }))
    expect(await within(drawer()).findByRole('alert')).toHaveTextContent('Fact not found.')
  })
})
