import { fireEvent, screen, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '@/shared/i18n'
import { server } from '@/test/msw'
import { dictionaryApi, senseIds } from '@/test/public-api'
import { renderAt } from '@/test/render'
import { DeveloperGuide } from './index'

const routes = [{ path: '/developers', element: <DeveloperGuide /> }]
const endpoint = (title: string) => screen.getByRole('article', { name: title })

describe('DeveloperGuide', () => {
  afterEach(() => i18n.changeLanguage('en-US'))

  it('runs an endpoint from the page and checks the response against the contract [spec: site/try-it]', async () => {
    const api = dictionaryApi()
    server.use(...api.handlers)
    renderAt('/developers', routes)

    const entry = endpoint('Get an entry')
    fireEvent.change(within(entry).getByRole('textbox', { name: 'domain' }), { target: { value: 'biology' } })
    expect(within(entry).getByText(/curl -s '.*\/v1\/entries\/animal\?lang=zh&domain=biology'/)).toBeInTheDocument()
    fireEvent.click(within(entry).getByRole('button', { name: 'Send request' }))

    expect(await within(entry).findByText('200 OK')).toBeInTheDocument()
    expect(within(entry).getByText('Matches the contract')).toBeInTheDocument()
    expect(within(entry).getByText('content-type')).toBeInTheDocument()
    expect(within(entry).getByRole('region', { name: 'Body' }).textContent).toContain('"lemma": "animal"')
    expect(api.reads.at(-1)?.search).toBe('?lang=zh&domain=biology')

    // A path parameter can be any value; an error answer is checked against the error envelope.
    const lemma = within(entry).getByRole('textbox', { name: /^lemma/ })
    fireEvent.change(lemma, { target: { value: 'animalz' } })
    fireEvent.click(within(entry).getByRole('button', { name: 'Send request' }))
    expect(await within(entry).findByText('404 Not Found')).toBeInTheDocument()
    expect(within(entry).getByText('Matches the contract')).toBeInTheDocument()
  })

  it('fills sense examples with a real sense id and flags a response off the contract', async () => {
    server.use(
      ...dictionaryApi().handlers,
      http.get('/v1/senses/:id', ({ params }) => HttpResponse.json({ id: params.id })),
      http.get('/v1/sources', () => new HttpResponse('plain text', { headers: { 'content-type': 'text/plain' } })),
    )
    renderAt('/developers', routes)
    const sense = endpoint('Get a sense')
    expect(await within(sense).findByDisplayValue(senseIds.animal)).toBeInTheDocument()
    fireEvent.click(within(sense).getByRole('button', { name: 'Send request' }))
    expect(await within(sense).findByText(/Does not match the contract: \d+/)).toBeInTheDocument()

    const sources = endpoint('Data sources')
    fireEvent.click(within(sources).getByRole('button', { name: 'Send request' }))
    expect(await within(sources).findByText('The response is not JSON.')).toBeInTheDocument()

    const feedback = endpoint('Submit feedback')
    expect(within(feedback).queryByRole('button', { name: 'Send request' })).not.toBeInTheDocument()
    expect(within(feedback).getByText(new RegExp(`"target_id": "${senseIds.animal}"`))).toBeInTheDocument()
  })

  it('shows a request the browser could not send', async () => {
    server.use(
      ...dictionaryApi().handlers,
      http.get('/v1/topics', () => HttpResponse.error()),
    )
    renderAt('/developers', routes)
    const topics = endpoint('Topic taxonomy')
    fireEvent.click(within(topics).getByRole('button', { name: 'Send request' }))
    expect(await within(topics).findByRole('alert')).toBeInTheDocument()
  })

  it('reads in Chinese and switches to English in place [spec: site/developer-guide]', async () => {
    server.use(...dictionaryApi().handlers)
    await i18n.changeLanguage('zh-CN')
    renderAt('/developers', routes)
    expect(screen.getByRole('heading', { level: 1, name: '开发者指南' })).toBeInTheDocument()
    const toc = screen.getByRole('navigation', { name: '目录' })
    expect(within(toc).getByRole('link', { name: '速率限制' })).toHaveAttribute('href', '#limits')
    expect(screen.getByText(/每个客户端地址每分钟最多 120 次读取/)).toBeInTheDocument()
    expect(screen.getByText(/带服务密钥的读取改为每个服务每分钟最多 6000 次/)).toBeInTheDocument()
    expect(screen.getByText(/vn_service_ 服务密钥/)).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'rate_limited' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /\/docs/ })).toHaveAttribute('href', '/docs')
    expect(screen.getByRole('link', { name: /\/openapi\.json/ })).toHaveAttribute('href', '/openapi.json')

    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Developer guide' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
  })
})
