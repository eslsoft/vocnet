import { screen, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '@/shared/i18n'
import { server } from '@/test/msw'
import { apiError, goEntry } from '@/test/public-api'
import { renderAt } from '@/test/render'
import { EntryView } from './index'

const routes = [{ path: '/words/go', element: <EntryView lemma="go" domain={undefined} /> }]

describe('EntryView with less common shapes', () => {
  afterEach(() => i18n.changeLanguage('en-US'))

  it('shows irregular forms, weak forms, variants, regions, and shortenings', async () => {
    server.use(http.get('/v1/entries/go', () => HttpResponse.json(goEntry())))
    await i18n.changeLanguage('zh-CN')
    renderAt('/words/go', routes)

    expect(await screen.findByRole('heading', { level: 1, name: 'go' })).toBeInTheDocument()
    expect(screen.queryByText('词频')).not.toBeInTheDocument()
    expect(screen.getByText('goe')).toBeInTheDocument()
    const verb = screen.getByRole('region', { name: '动词' })
    expect(within(verb).getByText('went')).toBeInTheDocument()
    expect(within(verb).getAllByTitle('不规则形式')).toHaveLength(3)
    expect(within(verb).getByText('/ɡə/')).toBeInTheDocument()
    expect(within(verb).getByText('弱读')).toBeInTheDocument()
    expect(within(verb).getByText('south african')).toBeInTheDocument()
    expect(within(verb).getByText('We went home.')).toBeInTheDocument()
    expect(within(verb).getByRole('link', { name: '旅行' })).toBeInTheDocument()
    expect(screen.getByText('“going”的截短词')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'going' })).toHaveAttribute('href', '/words/going')
    expect(screen.queryByRole('heading', { name: '短语' })).not.toBeInTheDocument()
  })

  it('shows a failed read where the entry would be', async () => {
    server.use(http.get('/v1/entries/go', () => apiError(429, 'rate_limited', 'Too many requests.')))
    renderAt('/words/go', routes)
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests.')
  })
})
