import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '@/shared/i18n'
import { server } from '@/test/msw'
import { memberIds, networkApi } from '@/test/public-api'
import { renderAt } from '@/test/render'
import { BrowsePage } from './index'

const routes = [
  { path: '/browse', element: <BrowsePage /> },
  { path: '/words/:lemma', element: <p>entry page</p> },
]

describe('BrowsePage', () => {
  it('expands a category’s kinds level by level [spec: site/browse-expand]', async () => {
    const api = networkApi()
    server.use(...api.handlers)
    const view = renderAt('/browse', routes)

    expect(screen.getByText('Pick a category above to see its kinds.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'animal' }))
    expect(view.location()).toBe('/browse?root=animal')
    expect(await screen.findByRole('heading', { name: 'animal' })).toBeInTheDocument()
    // The category sense is the one with the most kinds; the others are offered beside it.
    expect(screen.getByText('A living creature that is not a plant or a human.')).toBeInTheDocument()

    expect(await screen.findByRole('link', { name: /bird/ })).toHaveAttribute(
      'href',
      `/words/bird#sense-${memberIds.bird}`,
    )
    expect(screen.getByRole('link', { name: /fish/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /eagle/ })).not.toBeInTheDocument()

    const expand = screen.getByRole('button', { name: 'Kinds of bird' })
    fireEvent.click(expand)
    expect(expand).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('link', { name: /eagle/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Kinds of eagle' }))
    expect(await screen.findByText('No kinds listed yet.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Kinds of fish' }))
    expect(await screen.findByRole('link', { name: /lion/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByRole('link', { name: /tiger/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Kinds of lion' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sense not found.')
    expect(api.reads.slice(0, 3).map((url) => url.pathname)).toEqual([
      expect.stringMatching(/\/members$/),
      `/v1/senses/${memberIds.bird}/members`,
      `/v1/senses/${memberIds.eagle}/members`,
    ])
  })

  it('offers the other senses of a category word', async () => {
    server.use(...networkApi().handlers)
    const view = renderAt('/browse?root=animal', routes)
    await screen.findByRole('link', { name: /bird/ })
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    expect(view.location()).toMatch(/sense=/)
    expect(await screen.findByText('No kinds listed yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    expect(view.location()).toBe('/browse?root=animal')
  })

  it('says when a category word has no kinds', async () => {
    server.use(...networkApi().handlers)
    renderAt('/browse?root=colour', routes)
    expect(await screen.findByText('No kinds listed yet.')).toBeInTheDocument()
  })

  it('walks a specialist layer when one is picked', async () => {
    const api = networkApi()
    server.use(...api.handlers)
    renderAt('/browse?root=animal', routes)
    await screen.findByRole('link', { name: /bird/ })
    fireEvent.click(screen.getByRole('link', { name: 'Biology' }))
    await screen.findByRole('link', { name: /bird/ })
    expect(api.reads.at(-1)?.searchParams.get('domain')).toBe('biology')
  })

  it('shows a failed read of the category', async () => {
    server.use(...networkApi().handlers)
    renderAt('/browse?root=food', routes)
    expect(await screen.findByRole('alert')).toHaveTextContent('No entry for "food".')
  })

  it('lists the words of a topic page by page [spec: site/browse-topics]', async () => {
    const api = networkApi()
    server.use(...api.handlers)
    const view = renderAt('/browse?view=topics', routes)

    expect(await screen.findByText('Pick a topic to see its words.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Wild animals' }))
    expect(view.location()).toBe('/browse?view=topics&topic=wild-animals')
    expect(await screen.findByRole('heading', { name: 'Wild animals' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /lion/ })).toHaveAttribute(
      'href',
      `/words/lion#sense-${memberIds.lion}`,
    )
    expect(api.reads.at(-1)?.search).toBe('?sort=frequency&lang=zh&limit=40')
    expect(screen.queryByRole('heading', { name: 'Specialized senses' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    // A specialized sense lists under its own heading, after the topic's core vocabulary.
    const specialized = await screen.findByRole('region', { name: 'Specialized senses' })
    expect(within(specialized).getByRole('link', { name: /tiger/ })).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Topics' })).getByRole('button', { name: 'Nature' }))
    expect(await screen.findByText('No published words carry this topic yet.')).toBeInTheDocument()
  })
})

describe('BrowsePage topics in Chinese', () => {
  afterEach(() => i18n.changeLanguage('en-US'))

  it('names topics in the reader’s language, and a topic outside the tree by its id', async () => {
    server.use(...networkApi().handlers)
    await i18n.changeLanguage('zh-CN')
    renderAt('/browse?topic=unlisted', routes)
    expect(await screen.findByRole('button', { name: '野生动物' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'unlisted' })).toBeInTheDocument()
  })

  it('shows a failed read of the taxonomy', async () => {
    server.use(...networkApi({ topicsFail: true }).handlers)
    renderAt('/browse?view=topics', routes)
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests.')
  })
})
