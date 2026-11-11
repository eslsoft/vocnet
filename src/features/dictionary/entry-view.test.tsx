import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useParams, useSearchParams } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { server } from '@/test/msw'
import { dictionaryApi, searchHit, senseIds } from '@/test/public-api'
import { renderAt } from '@/test/render'
import { EntryView } from './index'

function Page() {
  const { lemma = '' } = useParams()
  const [params] = useSearchParams()
  return <EntryView key={lemma} lemma={lemma} domain={(params.get('domain') as 'biology' | null) ?? undefined} />
}
const routes = [{ path: '/words/:lemma', element: <Page /> }]

describe('EntryView', () => {
  it('typesets an entry as a learner’s dictionary does [spec: site/entry]', async () => {
    const api = dictionaryApi()
    server.use(...api.handlers)
    renderAt('/words/animal', routes)

    expect(await screen.findByRole('heading', { level: 1, name: 'animal' })).toBeInTheDocument()
    expect(api.reads[0].search).toBe('?lang=zh')
    expect(screen.getByText('an·i·mal')).toBeInTheDocument()
    expect(screen.getByText('/ˈænɪml/')).toBeInTheDocument()
    expect(screen.getByText('/ˈænɪməl/')).toBeInTheDocument()
    expect(screen.getAllByText('A1')[0]).toHaveAttribute('title', 'CEFR level A1')
    expect(screen.getByText('Common')).toBeInTheDocument()

    const noun = screen.getByRole('region', { name: 'noun' })
    expect(within(noun).getByText('animals')).toBeInTheDocument()
    expect(within(noun).getByText('1.', { exact: false })).toBeInTheDocument()
    expect(within(noun).getByText('动物')).toBeInTheDocument()
    expect(within(noun).getByText('Please do not feed the animals.')).toBeInTheDocument()
    expect(within(noun).getByText('请不要给动物喂食。')).toBeInTheDocument()
    expect(within(noun).getByText('wild animal')).toBeInTheDocument()
    expect(within(noun).getByText('informal')).toBeInTheDocument()
    expect(within(noun).getByText('~ to do')).toBeInTheDocument()
    expect(within(noun).getByText('~ about')).toBeInTheDocument()
    expect(within(noun).getByRole('link', { name: 'Wild animals' })).toHaveAttribute(
      'href',
      '/browse?topic=wild-animals',
    )

    // Relations link to the related sense on its entry page; a lemma with several senses is numbered.
    const bird = within(noun).getByRole('link', { name: 'bird' })
    expect(bird.getAttribute('href')).toMatch(/^\/words\/bird#sense-/)
    expect(within(noun).getByRole('link', { name: 'cat 2' })).toBeInTheDocument()
    expect(within(noun).queryByRole('link', { name: 'kind11' })).not.toBeInTheDocument()
    fireEvent.click(within(noun).getByRole('button', { name: '+3 more' }))
    expect(within(noun).getByRole('link', { name: 'kind11' })).toBeInTheDocument()

    // A rare sense waits behind its summary, numbered after the common ones.
    const rare = screen.getByText('1 less common sense').closest('details') as HTMLDetailsElement
    expect(rare.open).toBe(false)
    expect(within(rare).getByText('An old sense nobody uses.')).toBeInTheDocument()

    const adjective = screen.getByRole('region', { name: 'adjective' })
    expect(within(adjective).getByText('[only before noun]')).toBeInTheDocument()
    expect(within(adjective).getByText('4.', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('root · breath')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'animalistic' })).toHaveAttribute('href', '/words/animalistic')
    expect(screen.getByRole('link', { name: 'animal kingdom' })).toHaveAttribute('href', '/words/animal%20kingdom')
  })

  it('shows the exact request and JSON slice behind a block [spec: site/entry-api]', async () => {
    server.use(...dictionaryApi().handlers)
    renderAt('/words/animal', routes)
    const noun = await screen.findByRole('region', { name: 'noun' })
    const sense = within(noun).getByText('A cruel person.').closest('li') as HTMLElement

    const toggle = within(sense).getByRole('button', { name: 'API' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const panel = within(sense).getByRole('region', { name: 'Where this block comes from' })
    expect(
      within(panel).getByText(
        /curl -s 'http:\/\/localhost(:\d+)?\/v1\/entries\/animal\?lang=zh' \| jq '\.meanings\[0\]\.senses\[1\]'/,
      ),
    ).toBeInTheDocument()
    expect(within(panel).getByText('Response slice .meanings[0].senses[1]')).toBeInTheDocument()
    expect(panel.textContent).toContain(`"id": "${senseIds.brute}"`)

    fireEvent.click(within(noun).getAllByRole('button', { name: 'API' })[0])
    expect(within(noun).getByText('Response slice .meanings[0]')).toBeInTheDocument()

    const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement
    fireEvent.click(within(header).getAllByRole('button', { name: 'API' })[0])
    expect(
      within(header).getByText(/jq '\{lemma, syllables, pronunciations, frequency, variants\}'/),
    ).toBeInTheDocument()

    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Copy' })[0])
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('curl -s')))
    expect(await within(panel).findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('re-reads the entry in a specialist layer and marks its relations [spec: site/entry-domain]', async () => {
    const api = dictionaryApi()
    server.use(...api.handlers)
    const view = renderAt('/words/animal', routes)
    const noun = await screen.findByRole('region', { name: 'noun' })
    expect(within(noun).queryByRole('link', { name: /organism/ })).not.toBeInTheDocument()

    const layers = screen.getAllByRole('navigation', { name: 'Relations' })[0]
    expect(within(layers).getByRole('link', { name: 'Everyday' })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(within(layers).getByRole('link', { name: 'Biology' }))

    expect(await screen.findByRole('link', { name: /organism/ })).toHaveTextContent('organismBiology')
    expect(view.location()).toBe('/words/animal?domain=biology')
    expect(api.reads.at(-1)?.search).toBe('?lang=zh&domain=biology')
  })

  it('says a word is not in Vocnet yet and offers what a search finds [spec: site/entry-missing]', async () => {
    const api = dictionaryApi({
      search: [searchHit('animals', 'Plural of animal.'), { ...searchHit('animalsy', ''), gloss: null } as never],
    })
    server.use(...api.handlers)
    renderAt('/words/animals', routes)

    expect(await screen.findByRole('heading', { name: 'Not in Vocnet yet' })).toBeInTheDocument()
    expect(screen.getByText(/No entry is spelled exactly “animals”/)).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Plural of animal/ })).toHaveAttribute('href', '/words/animals')
    expect(api.reads.map((url) => url.pathname)).toEqual(['/v1/entries/animals', '/v1/search'])
  })

  it('says so when a search finds nothing either', async () => {
    server.use(...dictionaryApi().handlers)
    renderAt('/words/zzz', routes)
    expect(await screen.findByText('Nothing matches that search either.')).toBeInTheDocument()
  })

  it('opens and highlights the sense a relation link points at [spec: site/relation-link]', async () => {
    server.use(...dictionaryApi().handlers)
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    renderAt(`/words/animal#sense-${senseIds.rare}`, routes)

    const rare = await screen.findByText('An old sense nobody uses.')
    expect((rare.closest('details') as HTMLDetailsElement).open).toBe(true)
    expect(rare.closest('li')).toHaveClass('ring-1')
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('link', { name: 'bird' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'bird' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Word family' })).not.toBeInTheDocument()
  })
})
