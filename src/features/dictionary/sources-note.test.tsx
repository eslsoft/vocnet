import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { server } from '@/test/msw'
import { sourcesHandler } from '@/test/public-api'
import { renderAt } from '@/test/render'
import { SourcesNote } from './index'

const routes = [{ path: '/', element: <SourcesNote /> }]

describe('SourcesNote', () => {
  it('credits every reference source with its licence and attribution [spec: site/sources]', async () => {
    server.use(sourcesHandler())
    renderAt('/', routes)
    expect(screen.getByText('Loading data sources…')).toBeInTheDocument()
    expect(await screen.findByText('wordfreq')).toBeInTheDocument()
    expect(screen.getByText('CC BY-SA 4.0')).toBeInTheDocument()
    expect(screen.getByText(/Word frequencies from wordfreq/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Licence terms' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by-sa/4.0/',
    )
  })

  it('shows why the sources failed to load', async () => {
    server.use(sourcesHandler(null))
    renderAt('/', routes)
    expect(await screen.findByRole('alert')).toHaveTextContent('Sources are unavailable.')
  })
})
