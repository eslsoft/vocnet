import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiError, consoleApi, type EntryRecord, fact } from '@/test/console-api'
import { server } from '@/test/msw'
import { renderAt } from '@/test/render'
import { chooseOption } from '@/test/select'
import { HEAVY_TEST_MS } from '@/test/timeouts'
import { EntryList } from './index'

const routes = [
  { path: '/console/entries', element: <EntryList /> },
  { path: '/console/entries/:lemma', element: <p>inspector</p> },
]

const work = (
  total: number,
  rest: Partial<{ in_progress: number; waiting_on_review: number; stuck: number }> = {},
) => ({
  total,
  in_progress: 0,
  waiting_on_review: 0,
  stuck: 0,
  ...rest,
})

function world() {
  const run: EntryRecord = {
    id: crypto.randomUUID(),
    lemma: 'run',
    last_worked_at: new Date(Date.now() - 180_000).toISOString(),
    summary: {
      level: 'A1',
      completeness: 0.93,
      quality: 0.986,
      slots: { total: 212, published: 188, pending: 9 },
      open_work: work(24, { stuck: 2, in_progress: 4 }),
    },
  }
  const runner: EntryRecord = {
    id: crypto.randomUUID(),
    lemma: 'runner',
    summary: { level: 'B1', completeness: 1, quality: 1, open_work: work(0) },
  }
  const rugby: EntryRecord = {
    id: crypto.randomUUID(),
    lemma: 'rugby',
    summary: { level: 'B1', quality: 0.95, open_work: work(4, { waiting_on_review: 3 }) },
  }
  const running: EntryRecord = {
    id: crypto.randomUUID(),
    lemma: 'running',
    summary: { open_work: work(30, { in_progress: 6 }) },
  }
  const plain: EntryRecord = { id: crypto.randomUUID(), lemma: 'rule', summary: { open_work: work(14) } }
  const filler = Array.from({ length: 55 }, (_, index) => ({
    id: crypto.randomUUID(),
    lemma: `word${String(index).padStart(2, '0')}`,
  }))
  const sense = { id: crypto.randomUUID(), entry_id: run.id, pos: 'verb' as const }
  const facts = [
    fact({ kind: 'entry', payload: {}, subject_id: run.id }),
    fact({ kind: 'sense', payload: { gloss: 'move fast' }, subject_id: sense.id }),
    fact({ kind: 'entry', payload: {}, subject_id: rugby.id }),
    fact({ kind: 'entry', payload: {}, subject_id: runner.id }),
  ]
  return consoleApi({ entries: [run, runner, rugby, running, plain, ...filler], senses: [sense], facts })
}

const rowOf = async (lemma: string) => (await screen.findByRole('link', { name: lemma })).closest('tr') as HTMLElement
const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent)

describe('EntryList', () => {
  it(
    'shows each entry with level, completeness, quality, and open tasks, page by page [spec: console/entry-list]',
    async () => {
      server.use(...world().handlers)
      const view = renderAt('/console/entries', routes)

      const run = await rowOf('run')
      expect(cells(run)).toEqual(['run', 'A1', '1', '93%197/212', '98.6%', '24 · 2 stuck', '3 min. ago'])
      expect(
        within(run).getByRole('img', { name: '188 filled by published facts and 9 pending review, of 212' }),
      ).toBeVisible()
      expect(within(run).getByText('24 · 2 stuck')).toHaveClass('text-destructive')
      expect(cells(await rowOf('runner'))).toEqual(['runner', 'B1', '0', '100%6/10', '100.0%', 'None', 'Never'])
      const rugby = await rowOf('rugby')
      expect(within(rugby).getByText('95.0%')).toHaveClass('text-warning-foreground')
      expect(cells(rugby)[5]).toBe('4 · 3 in review')
      expect(cells(await rowOf('running'))).toEqual([
        'running',
        '—',
        '0',
        '60%6/10',
        '—',
        '30 · 6 in progress',
        'Never',
      ])
      expect(cells(await rowOf('rule'))[5]).toBe('14')
      expect(screen.getByText('Filled, pending review')).toBeInTheDocument()

      expect(screen.getAllByRole('row')).toHaveLength(51)
      fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
      expect(await screen.findByRole('link', { name: 'word54' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()

      fireEvent.click(within(run).getAllByRole('cell')[2] as HTMLElement)
      expect(view.location()).toBe('/console/entries/run')
    },
    HEAVY_TEST_MS,
  )

  it(
    'narrows by prefix, level, flagged facts, and stuck tasks in the URL [spec: console/entry-list-filter]',
    async () => {
      server.use(...world().handlers)
      const view = renderAt('/console/entries?prefix=ru', routes)
      const input = screen.getByRole('searchbox', { name: 'Entry starts with' })
      expect(input).toHaveValue('ru')
      expect(await screen.findByRole('link', { name: 'run' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'word00' })).not.toBeInTheDocument()

      await chooseOption('Level', 'B1')
      await waitFor(() => expect(screen.queryByRole('link', { name: 'run' })).not.toBeInTheDocument())
      expect(await screen.findByRole('link', { name: 'rugby' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Has flagged facts' }))
      await waitFor(() => expect(screen.queryByRole('link', { name: 'runner' })).not.toBeInTheDocument())
      expect(view.location()).toBe('/console/entries?prefix=ru&level=B1&flagged=true')
      fireEvent.click(screen.getByRole('button', { name: 'Has stuck tasks' }))
      expect(await screen.findByText('No entries match these filters.')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Has stuck tasks' }))
      fireEvent.click(screen.getByRole('button', { name: 'Has flagged facts' }))
      await chooseOption('Level', 'All')
      fireEvent.change(input, { target: { value: '  ' } })
      await waitFor(() => expect(view.location()).toBe('/console/entries'))
      expect(await screen.findByRole('link', { name: 'word00' })).toBeInTheDocument()

      view.router.navigate(-1)
      await waitFor(() => expect(input).toHaveValue('ru'))
    },
    HEAVY_TEST_MS,
  )

  it('surfaces a failed list', async () => {
    server.use(http.get('/manage/v1/entries', () => apiError(403, 'forbidden', 'Admins only.')))
    renderAt('/console/entries', routes)
    expect(await screen.findByRole('alert')).toHaveTextContent('Admins only.')
  })
})
