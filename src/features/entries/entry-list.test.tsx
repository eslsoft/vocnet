import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { consoleApi, fact, review } from '@/test/console-api'
import { server } from '@/test/msw'
import { renderAt } from '@/test/render'
import { EntryList } from './index'

const routes = [
  { path: '/entries', element: <EntryList /> },
  { path: '/entries/:lemma', element: <p>inspector</p> },
]

function world() {
  const bank = { id: crypto.randomUUID(), lemma: 'bank', last_worked_at: '2026-11-08T09:30:00.000Z' }
  const river = { id: crypto.randomUUID(), entry_id: bank.id, pos: 'noun' as const }
  const money = { id: crypto.randomUUID(), entry_id: bank.id, pos: 'noun' as const }
  const filler = Array.from({ length: 55 }, (_, index) => ({
    id: crypto.randomUUID(),
    lemma: `word${String(index).padStart(2, '0')}`,
  }))
  const facts = [
    fact({ kind: 'entry', payload: {}, subject_id: bank.id }),
    fact({ kind: 'sense', payload: { gloss: 'land beside a river' }, subject_id: river.id }),
    fact({ kind: 'sense', payload: { gloss: 'a money place' }, subject_id: money.id, status: 'pending', review: null }),
    fact({
      kind: 'example',
      payload: { text: 'A bank of fog.' },
      subject_id: river.id,
      status: 'rejected',
      review: review({ verdict: 'fail', confidence: 0.1 }),
    }),
    ...filler.map((entry) => fact({ kind: 'entry', payload: {}, subject_id: entry.id, status: 'pending' })),
  ]
  return consoleApi({
    entries: [{ id: crypto.randomUUID(), lemma: 'band' }, bank, ...filler],
    senses: [river, money],
    facts,
  })
}

const rowOf = async (lemma: string) => (await screen.findByRole('link', { name: lemma })).closest('tr') as HTMLElement

describe('EntryList', () => {
  it('lists entries with their progress, page by page, and opens one [spec: console/entry-list]', async () => {
    server.use(...world().handlers)
    const view = renderAt('/entries', routes)

    const bank = await rowOf('bank')
    expect(within(bank).getByText('Published')).toBeInTheDocument()
    expect(
      within(bank)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['bank', 'Published', '2', '2', '1', '1', expect.stringMatching(/2026/)])
    const band = await rowOf('band')
    expect(within(band).getByText('No entry fact')).toBeInTheDocument()
    expect(within(band).getByText('Never')).toBeInTheDocument()

    expect(screen.getAllByRole('row')).toHaveLength(51)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByRole('link', { name: 'word54' })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(58)
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()

    fireEvent.click(within(bank).getAllByRole('cell')[2] as HTMLElement)
    expect(view.location()).toBe('/entries/bank')
  })

  it('filters by a debounced prefix kept in the URL [spec: console/entry-list-filter]', async () => {
    server.use(...world().handlers)
    const view = renderAt('/entries?prefix=ban', routes)
    const input = screen.getByLabelText('Lemma starts with')
    expect(input).toHaveValue('ban')
    expect(await screen.findByRole('link', { name: 'band' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'word00' })).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: ' bank ' } })
    expect(view.location()).toBe('/entries?prefix=ban')
    await waitFor(() => expect(view.location()).toBe('/entries?prefix=bank'))
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'band' })).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'bank' })).toBeInTheDocument()
    })

    fireEvent.change(input, { target: { value: 'zebra' } })
    expect(await screen.findByText('No entries match this prefix.')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '  ' } })
    await waitFor(() => expect(view.location()).toBe('/entries'))
    expect(await screen.findByRole('link', { name: 'word00' })).toBeInTheDocument()

    view.router.navigate(-1)
    await waitFor(() => expect(input).toHaveValue('zebra'))
  })
})
