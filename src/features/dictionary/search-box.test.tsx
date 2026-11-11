import { act, fireEvent, screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '@/test/msw'
import { apiError, dictionaryApi, searchHit } from '@/test/public-api'
import { renderAt } from '@/test/render'
import { SearchBox } from './index'

const routes = [
  { path: '/', element: <SearchBox size="lg" /> },
  { path: '/words/:lemma', element: <p>entry page</p> },
]
const hits = [searchHit('animal', 'A living creature.'), searchHit('animation', 'Moving pictures.')]

describe('SearchBox', () => {
  it('searches as you type and opens a hit from the keyboard [spec: site/home-search]', async () => {
    const api = dictionaryApi({ search: hits })
    server.use(...api.handlers)
    const view = renderAt('/', routes)
    const box = screen.getByRole('combobox', { name: 'Search the dictionary' })

    fireEvent.keyDown(document.body, { key: '/' })
    expect(box).toHaveFocus()
    fireEvent.change(box, { target: { value: 'anim' } })
    expect(await screen.findByRole('option', { name: /animation/ })).toBeInTheDocument()
    expect(box).toHaveAttribute('aria-expanded', 'true')
    expect(api.reads.at(-1)?.search).toBe('?q=anim&limit=8&lang=zh')
    expect(screen.getAllByRole('option')).toHaveLength(2)

    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    expect(screen.getByRole('option', { name: /animation/ })).toHaveAttribute('aria-selected', 'true')
    expect(box.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: /animation/ }).id)
    fireEvent.submit(box.closest('form') as HTMLFormElement)
    expect(view.location()).toBe('/words/animation')
  })

  it('looks the text up as a headword when no hit is chosen, and closes on Escape', async () => {
    server.use(...dictionaryApi({ search: hits }).handlers)
    const view = renderAt('/', routes)
    const box = screen.getByRole('combobox')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'zebra' } })
    expect(await screen.findByText(/Nothing matches “zebra”/)).toBeInTheDocument()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box).toHaveAttribute('aria-expanded', 'false')
    fireEvent.change(box, { target: { value: 'anim' } })
    const option = await screen.findByRole('option', { name: /A living creature/ })
    fireEvent.mouseEnter(option)
    expect(option).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(option, { key: 'Enter' })
    fireEvent.click(option)
    expect(view.location()).toBe('/words/animal')

    await act(() => view.router.navigate('/'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: ' zebra ' } })
    fireEvent.submit(screen.getByRole('combobox').closest('form') as HTMLFormElement)
    expect(view.location()).toBe('/words/zebra')
  })

  it('shows a failed search in the list', async () => {
    server.use(http.get('/v1/search', () => apiError(400, 'invalid_request', 'The query is too long.')))
    renderAt('/', routes)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'x' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('The query is too long.')
  })

  it('leaves / to the page’s primary search box and to fields being typed in', () => {
    server.use(http.get('/v1/search', () => HttpResponse.json({ lang: 'zh', items: [], next_cursor: null })))
    renderAt('/', [
      {
        path: '/',
        element: (
          <>
            <SearchBox size="lg" />
            <SearchBox />
            <input aria-label="other" />
          </>
        ),
      },
    ])
    const [primary, header] = screen.getAllByRole('combobox')
    fireEvent.keyDown(screen.getByLabelText('other'), { key: '/' })
    expect(primary).not.toHaveFocus()
    fireEvent.keyDown(document.body, { key: '/' })
    expect(primary).toHaveFocus()
    expect(header).not.toHaveFocus()
  })
})
