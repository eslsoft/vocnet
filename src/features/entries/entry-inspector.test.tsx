import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { useParams } from 'react-router'
import { describe, expect, it } from 'vitest'
import { agent, apiError, consoleApi, fact, fromNow, review, workTask } from '@/test/console-api'
import { server } from '@/test/msw'
import { dictionaryApi } from '@/test/public-api'
import { renderAt } from '@/test/render'
import { HEAVY_TEST_MS } from '@/test/timeouts'
import { EntryInspector } from './index'

function Page() {
  const { lemma = '' } = useParams()
  return <EntryInspector lemma={lemma} />
}

const routes = [
  { path: '/console/entries', element: <p>entry list</p> },
  { path: '/console/entries/:lemma', element: <Page /> },
]

const sourceOf = (sourceId: string) => ({
  id: sourceId,
  name: `${sourceId} list`,
  version: '1.0',
  license: 'CC BY-SA 4.0',
  license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  changes: `Filtered by Vocnet from ${sourceId}.`,
  attribution: `Credit ${sourceId}.`,
  url: 'https://example.test/',
  retrieved_at: '2026-11-09',
})

function world() {
  const producer = agent({ name: 'producer-a1' })
  const run = {
    id: crypto.randomUUID(),
    lemma: 'run',
    summary: { completeness: 0.93, credibility: 0.88, slots: { total: 212, published: 188, pending: 9 } },
  }
  const sprint = { id: crypto.randomUUID(), lemma: 'sprint' }
  const operate = { id: crypto.randomUUID(), lemma: 'operate' }
  const sense = (entryId: string) => ({ id: crypto.randomUUID(), entry_id: entryId, pos: 'verb' as const })
  const [speed, manage, machine, fourth, rare, fresh] = Array.from({ length: 6 }, () => sense(run.id)) as Array<
    ReturnType<typeof sense>
  >
  const sprintSense = sense(sprint.id)
  const operateSense = sense(operate.id)
  const item = (node: { id: string } | undefined, gloss: string, rank: 'common' | 'extra' = 'common') => ({
    id: node?.id as never,
    pos: 'verb' as const,
    gloss,
    rank,
  })
  const flagged = fact({
    kind: 'example',
    payload: { sentence_id: crypto.randomUUID() as never, text: 'She ran to catch the last bus.' },
    subject_id: speed?.id,
    author: `agent:${producer.id}`,
    updated_at: fromNow(-180),
    review: review({ verdict: 'uncertain', confidence: 0.62 }),
  })
  const inventory = fact({
    kind: 'senses',
    payload: {
      senses: [
        item(speed, 'move at a speed faster than walking'),
        item(manage, 'be in charge of; manage'),
        item(machine, 'operate or function'),
        item(fourth, 'flow'),
        { ...item(rare, 'compete in an election', 'extra'), region: 'american' as const },
      ],
    },
    subject_id: run.id,
  })
  const facts = [
    fact({ kind: 'pronunciation', payload: { ipa: 'rʌn', accent: 'us' }, subject_id: run.id }),
    fact({
      kind: 'form',
      payload: { form: 'runs', type: 'third_person_singular' },
      subject_id: run.id,
      status: 'pending',
      review: null,
    }),
    inventory,
    fact({
      kind: 'phrases',
      payload: {
        phrases: [
          { type: 'phrasal_verb', entry_id: crypto.randomUUID() as never, text: 'run out' },
          { type: 'phrasal_verb', entry_id: crypto.randomUUID() as never, text: 'run into' },
        ],
      },
      subject_id: run.id,
      status: 'pending',
      review: null,
    }),
    flagged,
    fact({
      kind: 'translation',
      payload: { language: 'zh', of: 'sentence', text: '她跑着去赶末班车。' },
      subject_id: (flagged.payload as { sentence_id: string }).sentence_id,
    }),
    fact({
      kind: 'example',
      payload: { sentence_id: crypto.randomUUID() as never, text: 'The children ran across the field.' },
      subject_id: speed?.id,
      status: 'superseded',
    }),
    fact({
      kind: 'translation',
      payload: { language: 'zh', of: 'sense', text: '运行' },
      subject_id: manage?.id,
      status: 'rejected',
      review: review({ verdict: 'fail' }),
    }),
    fact({
      kind: 'example',
      payload: { sentence_id: crypto.randomUUID() as never, text: 'She runs a bakery.' },
      subject_id: manage?.id,
      status: 'pending',
      review: null,
    }),
    fact({
      kind: 'relation',
      payload: { type: 'synonym', target_sense_id: sprintSense.id as never },
      subject_id: speed?.id,
      object_id: sprintSense.id as never,
    }),
    fact({
      kind: 'relation',
      payload: { type: 'antonym', target_sense_id: machine?.id as never },
      subject_id: sprintSense.id,
      object_id: machine?.id as never,
    }),
    fact({
      kind: 'relation',
      payload: { type: 'synonym', target_sense_id: manage?.id as never },
      subject_id: operateSense.id,
      object_id: manage?.id as never,
      status: 'pending',
      review: null,
    }),
  ]
  const entry = { id: run.id as never, lemma: 'run' }
  const tasks = [
    workTask({
      entry,
      subject_id: speed?.id,
      sense_gloss: 'move fast',
      stage: 2,
      gap: { type: 'topics', sense_id: speed?.id as never },
    }),
    workTask({
      entry,
      subject_id: manage?.id,
      sense_gloss: 'be in charge of; manage',
      gap: { type: 'grammar', sense_id: manage?.id as never },
      status: 'stuck',
      attempts_without_progress: 2,
    }),
    workTask({
      entry,
      subject_id: machine?.id,
      gap: { type: 'examples', sense_id: machine?.id as never, count: 1, need: 2 },
      status: 'in_progress',
      lease: { holder: `agent:${producer.id}`, expires_at: fromNow(720) },
    }),
    workTask({
      entry,
      stage: 3,
      gap: { type: 'translations', language: 'zh', missing: [{ of: 'sense', id: speed?.id as string }] },
      status: 'in_progress',
    }),
    workTask({ entry, gap: { type: 'syllables' } }),
    workTask({ entry, gap: { type: 'phrases' }, status: 'waiting_on_review' }),
  ]
  return consoleApi({
    entries: [run, sprint, operate, { id: crypto.randomUUID(), lemma: 'empty' }],
    senses: [speed, manage, machine, fourth, rare, fresh, sprintSense, operateSense] as never,
    facts,
    tasks,
    agents: [producer],
    references: {
      run: {
        frequency: { zipf: 6.1, rank: 212, source_id: 'wordfreq' },
        cefr: [
          { pos: 'verb', level: 'A1', source_id: 'cefrj' },
          { pos: 'noun', level: 'A2', source_id: 'octanove' },
        ],
      },
    },
    referenceSources: ['wordfreq', 'cefrj', 'octanove', 'unused'].map(sourceOf),
  })
}

const section = (name: string) => screen.getByRole('region', { name })

describe('EntryInspector', { timeout: HEAVY_TEST_MS }, () => {
  it('heads the entry with its batch, reference badges, and three scores [spec: console/entry-inspector]', async () => {
    server.use(...world().handlers)
    renderAt('/console/entries/run', routes)

    expect(await screen.findByRole('heading', { level: 1, name: /^run\s*\/rʌn\/$/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Entries' })).toHaveAttribute('href', '/console/entries')
    expect(screen.getByText('A1 verb · A2 noun')).toBeInTheDocument()
    expect(screen.getByText('Frequency rank #212')).toBeInTheDocument()
    expect(screen.getByText('Batch 1')).toBeInTheDocument()
    expect(await screen.findByText(/^6 senses · updated .* by producer-a1$/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Public page' })).toHaveAttribute('href', '/words/run')

    expect(section('Completeness')).toHaveTextContent('93%197 of 212 filled · 9 pending review')
    expect(section('Credibility')).toHaveTextContent(/88%.*How often its least reliable published fact/)
    const open = section('Open tasks')
    await waitFor(() => expect(open).toHaveTextContent('6'))
    expect(open).toHaveTextContent('2 queued · 2 in progress · 1 in review · 1 stuck')
    expect(screen.getByRole('tab', { name: 'Tasks · 6' })).toBeInTheDocument()
  })

  it('typesets each sense with its facts, states, and the open tasks in place [spec: console/entry-inspector]', async () => {
    server.use(...world().handlers)
    const view = renderAt('/console/entries/run', routes)

    const first = await screen.findByRole('region', { name: 'Sense 1' })
    expect(within(first).getByText('move at a speed faster than walking')).toBeInTheDocument()
    const flaggedRow = within(first).getByText('She ran to catch the last bus.').closest('button') as HTMLElement
    expect(flaggedRow).toHaveAttribute('data-state', 'flagged')
    expect(within(flaggedRow).getByText('Flagged · 62%')).toBeInTheDocument()
    expect(within(first).queryByText('The children ran across the field.')).not.toBeInTheDocument()
    expect(await within(first).findByText('sprint')).toBeInTheDocument()
    const topic = await within(first).findByRole('link', { name: /No topic yet\./ })
    expect(topic).toHaveTextContent(/Topics task · created .*Queued/)
    const translation = within(first).getByText('她跑着去赶末班车。').closest('button') as HTMLElement
    expect(translation).toHaveTextContent('Sentence她跑着去赶末班车。')

    const second = section('Sense 2')
    expect(within(second).getByText('运行').closest('button')).toHaveAttribute('data-state', 'rejected')
    expect(within(second).getByText('She runs a bakery.').closest('button')).toHaveAttribute('data-state', 'pending')
    expect(await within(second).findByText('← linked from operate')).toBeInTheDocument()
    expect(within(second).getByRole('link', { name: /No grammar note yet\./ })).toHaveTextContent(
      '2 tries without progressStuck',
    )
    expect(await within(section('Sense 3')).findByRole('link', { name: /Needs 1 more example/ })).toHaveTextContent(
      /producer-a1 · 1[12]m.* leftIn progress/,
    )

    const antonym = (await within(section('Sense 3')).findByText('← linked from sprint')).closest(
      'button',
    ) as HTMLElement
    expect(antonym).toHaveAttribute('data-state', 'published')
    expect(antonym).toHaveTextContent('antonym')
    fireEvent.click(antonym)
    expect(view.location()).toMatch(/^\/console\/entries\/run\?fact=/)
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(view.location()).toBe('/console/entries/run'))

    expect(screen.queryByRole('region', { name: 'Sense 4' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 more senses' }))
    expect(within(section('Sense 5')).getByText('Less common')).toBeInTheDocument()
    expect(within(section('Sense 5')).getByText('american')).toBeInTheDocument()
    expect(within(section('Sense 6')).getByText('Not in the inventory')).toBeInTheDocument()
    expect(within(section('Sense 6')).getByText('No definition yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer senses' }))
    expect(screen.queryByRole('region', { name: 'Sense 4' })).not.toBeInTheDocument()

    fireEvent.click(flaggedRow)
    expect(view.location()).toMatch(/^\/console\/entries\/run\?fact=/)
    expect(await within(await screen.findByRole('dialog')).findByText('Flagged · 62% confidence')).toBeInTheDocument()
  })

  it('outlines the senses, the word details with their tasks, and the reference data [spec: console/entry-reference]', async () => {
    server.use(...world().handlers)
    renderAt('/console/entries/run', routes)

    const outline = (await screen.findByText('Decided once: after it publishes, only a curator changes it.')).closest(
      '[data-slot=card]',
    ) as HTMLElement
    expect(
      within(outline)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      '1verb move at a speed faster than walking',
      '2verb be in charge of; manage',
      '3verb operate or function',
      '4verb flow',
      '5verb compete in an electionamericanLess common',
    ])
    expect(within(outline).getByText('1 sense not in the inventory')).toBeInTheDocument()
    fireEvent.click(within(outline).getByRole('button', { name: /4 common · 1 less common/ }))
    expect(await within(await screen.findByRole('dialog')).findByText('compete in an election')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const details = screen.getByText('Word details').closest('[data-slot=card]') as HTMLElement
    const row = (label: string) => within(details).getByText(label).nextElementSibling as HTMLElement
    expect(row('Pronunciation')).toHaveTextContent('/rʌn/ (us)')
    expect(row('Forms')).toHaveTextContent('runs (third_person_singular)Pending')
    expect(await within(details).findByText('run out (phrasal_verb) · run into (phrasal_verb)')).toBeInTheDocument()
    expect(row('Phrases')).toHaveTextContent('run out (phrasal_verb) · run into (phrasal_verb)PendingWaiting on review')
    expect(row('Syllables')).toHaveTextContent('No syllable division yet.Queued')
    expect(row('Translations')).toHaveTextContent('1 item has no Chinese translation.In progress')
    expect(row('Word formation')).toHaveTextContent('—')
    fireEvent.click(within(row('Pronunciation')).getByRole('button'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    const reference = screen.getByText('Reference data').closest('[data-slot=card]') as HTMLElement
    expect(within(reference).getByText('Rank 212')).toBeInTheDocument()
    expect(within(reference).getByText('verb A1 · noun A2')).toBeInTheDocument()
    expect(await within(reference).findByText(/Credit wordfreq\./)).toBeInTheDocument()
    expect(within(reference).getByText(/Credit octanove\./)).toHaveTextContent('Filtered by Vocnet from octanove.')
    expect(within(reference).queryByText(/Credit unused\./)).not.toBeInTheDocument()
  })

  it("lists the entry's open tasks in their tab and settles one [spec: console/entry-tasks]", async () => {
    const api = world()
    server.use(...api.handlers)
    const view = renderAt('/console/entries/run', routes)
    fireEvent.click(await screen.findByRole('tab', { name: 'Tasks · 6' }))
    await waitFor(() => expect(view.location()).toBe('/console/entries/run?view=tasks'))
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(7)
    const grammar = within(table).getByText('No grammar note yet.').closest('tr') as HTMLElement
    expect(within(grammar).getByText('Stuck')).toBeInTheDocument()
    expect(within(table).getAllByText('whole entry')).toHaveLength(4)
    expect(within(grammar).getByText('be in charge of; manage')).toBeInTheDocument()

    fireEvent.click(within(grammar).getByRole('button', { name: 'Settle' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settle Grammar for run' })
    fireEvent.change(within(dialog).getByLabelText('Why nothing fills it'), {
      target: { value: 'This sense has no grammar a learner needs.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Settle slot' }))
    await waitFor(() => expect(screen.queryByText('No grammar note yet.')).not.toBeInTheDocument())
    expect(api.state.passes).toEqual([
      expect.objectContaining({ type: 'grammar', note: 'This sense has no grammar a learner needs.' }),
    ])
    expect(await screen.findByRole('tab', { name: 'Tasks · 5' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Facts and gaps' }))
    await waitFor(() => expect(view.location()).toBe('/console/entries/run'))
  })

  it('previews the public page', async () => {
    const api = world()
    api.state.entries.push({ id: crypto.randomUUID(), lemma: 'animal' })
    server.use(...api.handlers, ...dictionaryApi().handlers)
    renderAt('/console/entries/animal?view=preview', routes)
    expect(await screen.findByRole('heading', { level: 1, name: 'animal' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /animal/, level: 1, hidden: false })).toBeInTheDocument()
    expect(await screen.findByText('an·i·mal')).toBeInTheDocument()
  })

  it('says when an entry has no senses or reference data, and why a lemma failed', async () => {
    const api = world()
    const empty = api.state.entries.find((entry) => entry.lemma === 'empty') as { id: string }
    api.state.tasks.push(workTask({ entry: { id: empty.id as never, lemma: 'empty' }, gap: { type: 'senses' } }))
    server.use(...api.handlers)
    renderAt('/console/entries/empty', routes)
    expect(await screen.findByText('No senses yet.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('No sense inventory yet.')).toHaveLength(2))
    expect(
      await screen.findByRole('link', { name: /No sense inventory yet\..*Sense inventory task/ }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Not listed')).toHaveLength(2)

    server.use(http.get('/manage/v1/work/items', () => apiError(403, 'forbidden', 'Tasks are hidden.')))
    server.use(http.get('/manage/v1/sources', () => apiError(403, 'forbidden', 'Sources are unavailable.')))
    renderAt('/console/entries/ghost', routes)
    expect(await screen.findByText('No entry for "ghost".')).toBeInTheDocument()
  })

  it('shows a failed task list where the tasks would be', async () => {
    server.use(...world().handlers)
    server.use(http.get('/manage/v1/work/items', () => apiError(403, 'forbidden', 'Tasks are hidden.')))
    renderAt('/console/entries/run', routes)
    expect(await screen.findByText('Tasks are hidden.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Tasks · 0' }))
    expect(await screen.findByText('No open tasks. Nothing is missing.')).toBeInTheDocument()
  })
})
