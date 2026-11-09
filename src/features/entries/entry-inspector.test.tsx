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
  return consoleApi({ entries: [bank, shore, empty], senses: [river, money, lean, coast], facts, ...reference })
}

const reference = {
  references: {
    bank: {
      frequency: { zipf: 5.16, rank: 1834, source_id: 'wordfreq' },
      cefr: [
        { pos: 'noun' as const, level: 'A1' as const, source_id: 'cefrj' },
        { pos: 'verb' as const, level: 'C1' as const, source_id: 'octanove' },
      ],
    },
  },
  referenceSources: ['wordfreq', 'cefrj', 'octanove', 'unused'].map((sourceId) => ({
    id: sourceId,
    name: `${sourceId} list`,
    version: '1.0',
    license: 'CC BY-SA 4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    changes: `Filtered by Vocnet from ${sourceId}.`,
    attribution: `Credit ${sourceId}.`,
    url: 'https://example.test/',
    retrieved_at: '2026-11-09',
  })),
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

  it('shows the reference data with the attribution of each source it came from [spec: console/entry-reference]', async () => {
    server.use(...world().handlers)
    renderAt('/entries/bank', routes)
    const card = (await screen.findByText('Reference data')).closest('[data-slot=card]') as HTMLElement
    expect(within(card).getByText('Zipf 5.16 · rank 1,834')).toBeInTheDocument()
    expect(within(card).getByText('noun A1')).toBeInTheDocument()
    expect(within(card).getByText('verb C1')).toBeInTheDocument()
    expect(await within(card).findByText(/Credit wordfreq\./)).toBeInTheDocument()
    expect(within(card).getByText(/Credit octanove\./)).toHaveTextContent('Filtered by Vocnet from octanove.')
    expect(within(card).getAllByRole('link', { name: 'CC BY-SA 4.0' })[0]).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by-sa/4.0/',
    )
    expect(within(card).queryByText(/Credit unused\./)).not.toBeInTheDocument()
  })

  it('says when a lemma has no reference data and reports a failed source list', async () => {
    server.use(
      ...consoleApi({ entries: [{ id: crypto.randomUUID(), lemma: 'empty' }], referenceSources: null }).handlers,
    )
    renderAt('/entries/empty', routes)
    const card = (await screen.findByText('Reference data')).closest('[data-slot=card]') as HTMLElement
    expect(within(card).getAllByText('Not listed')).toHaveLength(2)
    expect(await within(card).findByRole('alert')).toHaveTextContent('Sources are unavailable.')
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
