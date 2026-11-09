import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { agent, apiError, consoleApi } from '@/test/console-api'
import { server } from '@/test/msw'
import { renderAt } from '@/test/render'
import { AgentsPanel } from './index'

const routes = [{ path: '/agents', element: <AgentsPanel /> }]

describe('AgentsPanel', () => {
  it('issues a key and shows it exactly once [spec: console/agent-issue]', async () => {
    const api = consoleApi()
    server.use(...api.handlers)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderAt('/agents', routes)

    expect(await screen.findByText('No agents yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Issue key' }))
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Name'), { target: { value: 'Producer' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Issue' }))

    const [key] = await waitFor(() => {
      expect(api.state.issuedKeys).toHaveLength(1)
      return api.state.issuedKeys
    })
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByTestId('agent-secret')).toHaveTextContent(key)
    expect(within(dialog).getByRole('heading', { name: 'Key for Producer' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(await within(dialog).findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(key)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(await screen.findByRole('cell', { name: 'Producer' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('agent-secret')).not.toBeInTheDocument())
    expect(screen.getByText('Active')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Issue key' }))
    expect(within(await screen.findByRole('dialog')).getByLabelText('Name')).toHaveValue('')
    expect(screen.queryByText(key)).not.toBeInTheDocument()
  })

  it('shows why issuing failed in the dialog', async () => {
    server.use(...consoleApi().handlers)
    server.use(http.post('/manage/v1/agents', () => apiError(400, 'invalid_request', 'Invalid json: name: Too long')))
    renderAt('/agents', routes)
    fireEvent.click(await screen.findByRole('button', { name: 'Issue key' }))
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Name'), { target: { value: 'x' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Issue' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Too long')
  })

  it('revokes an agent after confirmation [spec: console/agent-revoke]', async () => {
    const api = consoleApi({
      agents: [agent({ name: 'Producer' }), agent({ name: 'Old', revoked_at: '2026-10-01T00:00:00.000Z' })],
    })
    server.use(...api.handlers)
    renderAt('/agents', routes)

    const row = (await screen.findByRole('cell', { name: 'Producer' })).closest('tr') as HTMLElement
    const old = screen.getByRole('cell', { name: 'Old' }).closest('tr') as HTMLElement
    expect(within(old).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()

    fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Revoke Producer?' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(within(row).getByText('Revoked')).toBeInTheDocument())
    expect(within(row).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
    expect(api.state.agents.every((candidate) => candidate.revoked_at)).toBe(true)
  })

  it('keeps the confirmation open with the error, and cancels', async () => {
    server.use(...consoleApi({ agents: [agent({ name: 'Producer' })] }).handlers)
    server.use(http.delete('/manage/v1/agents/:id', () => apiError(404, 'not_found', 'Agent not found.')))
    renderAt('/agents', routes)
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Agent not found.')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('surfaces a failed list', async () => {
    server.use(http.get('/manage/v1/agents', () => apiError(403, 'forbidden', 'Admins only.')))
    renderAt('/agents', routes)
    expect(await screen.findByRole('alert')).toHaveTextContent('Admins only.')
  })
})
