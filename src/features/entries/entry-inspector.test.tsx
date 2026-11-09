import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { consoleApi, fact, review } from '@/test/console-api'
import { server } from '@/test/msw'
import { renderAt } from '@/test/render'
import { EntryInspector } from './index'

function Page({ lemma }: { lemma: string }) {
  return <EntryInspector lemma={lemma} />
}

const routes = [
  { path: '/entries', element: <p>entry list</p> },
  { path: '/entries/bank', element: <Page lemma="bank" /> },
  { path: '/entries/ghost', element: <Page lemma="ghost" /> },
  { path: '/entries/empty', element: <Page lemma="empty" /> },
]

function world() {
  const bank = { id: crypto.randomUUID(), lemma: 'bank' }
  const shore = { id: crypto.randomUUID(), lemma: 'shore' }
  const empty = { id: crypto.randomUUID(), lemma: 'empty' }
  const river = { id: crypto.randomUUID(), entry_id: bank.id, pos: 'noun' as const }
  const money = { id: crypto.randomUUID(), entry_id: bank.id, pos: 'noun' as const }
  const lean = { id: crypto.randomUUID(), entry_id: bank.id, pos: 'verb' as const }
  const coast = { id: crypto.randomUUID(), entry_id: shore.id, pos: 'noun' as const }
  const facts = [
    fact({ kind: 'entry', payload: {}, subject_id: bank.id }),
    fact({
      kind: 'form',
      payload: { form: 'banks', type: 'plural' },
      subject_id: bank.id,
      status: 'pending',
      review: null,
    }),
    fact({ kind: 'sense', payload: { gloss: 'land beside a river' }, subject_id: river.id }),
    fact({
      kind: 'example',
      payload: { text: 'We fished from the bank.' },
      subject_id: river.id,
      review: review({ reviewer: 'llm', verdict: 'uncertain', confidence: 0.6 }),
    }),
    fact({ kind: 'sense', payload: { gloss: 'a money place' }, subject_id: money.id, status: 'pending', review: null }),
    fact({
      kind: 'translation',
      payload: { language: 'fr', text: 'rive' },
      subject_id: money.id,
      status: 'rejected',
      review: review({ verdict: 'fail', confidence: 0.1 }),
    }),
    fact({
      kind: 'relation',
      payload: { type: 'synonym', target_sense_id: river.id as never },
      subject_id: coast.id,
      object_id: river.id as never,
    }),
  ]
  return consoleApi({ entries: [bank, shore, empty], senses: [river, money, lean, coast], facts })
}

describe('EntryInspector', () => {
  it('shows every sense with its facts in every status [spec: console/entry-inspector]', async () => {
    server.use(...world().handlers)
    const view = renderAt('/entries/bank', routes)
    expect(await screen.findByRole('heading', { name: 'bank' })).toBeInTheDocument()
    const entryFacts = screen.getByText('Entry facts').closest('[data-slot=card]') as HTMLElement
    expect(within(entryFacts).getByText('banks (plural)')).toBeInTheDocument()

    const river = screen
      .getByText('land beside a river', { selector: '[data-slot=card-title]' })
      .closest('[data-slot=card]') as HTMLElement
    expect(within(river).getByText('Uncertain 60%')).toHaveAttribute('data-signal', 'flagged')
    expect(within(river).getByText('Relations pointing here')).toBeInTheDocument()
    expect(within(river).getByText(/^synonym → sense/)).toBeInTheDocument()

    const money = screen
      .getByText('a money place', { selector: '[data-slot=card-title]' })
      .closest('[data-slot=card]') as HTMLElement
    expect(within(money).getByText('Rejected')).toBeInTheDocument()
    expect(within(money).getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('No live gloss')).toBeInTheDocument()

    fireEvent.click(within(money).getByRole('button', { name: 'fr: rive' }))
    expect(await within(screen.getByRole('dialog')).findByText('Fail')).toBeInTheDocument()
    expect(view.location()).toMatch(/^\/entries\/bank\?fact=/)
  })

  it('shows the server message for an unknown lemma', async () => {
    server.use(...world().handlers)
    renderAt('/entries/ghost', routes)
    expect(await screen.findByRole('alert')).toHaveTextContent('No entry for "ghost".')
  })

  it('says when an entry has no senses and links back to the list', async () => {
    server.use(...world().handlers)
    const view = renderAt('/entries/empty', routes)
    expect(await screen.findByText('No senses yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'All entries' }))
    expect(view.location()).toBe('/entries')
  })
})
