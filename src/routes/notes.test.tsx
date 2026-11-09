import type { Note } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import '@/shared/i18n'
import { server } from '@/test/msw'
import NotesPage from './notes'

// Component test: real api client + react-query, API mocked at the network edge
// (MSW) with a small in-memory store so the post-mutation refetch converges.
function mockNotesBackend(initial: Note[] = []) {
  const store = [...initial]
  server.use(
    http.get('/api/notes', () => HttpResponse.json({ items: store, nextCursor: null })),
    http.post('/api/notes', async ({ request }) => {
      const body = (await request.json()) as { text: string }
      const item: Note = {
        id: '00000000-0000-4000-8000-000000000001',
        text: body.text.trim(),
        createdAt: '2026-01-01T00:00:00.000Z',
      }
      store.unshift(item)
      return HttpResponse.json({ item }, { status: 201 })
    }),
  )
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('NotesPage', () => {
  it('creates a note and shows it in the list [spec: notes/create]', async () => {
    mockNotesBackend()
    render(<NotesPage />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'Create note' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'first note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByText('first note')).toBeInTheDocument())
  })

  it('shows a create failure beside the form action', async () => {
    server.use(
      http.get('/api/notes', () => HttpResponse.json({ items: [], nextCursor: null })),
      http.post('/api/notes', () =>
        HttpResponse.json({ error: { code: 'internal_error', message: 'Could not create note.' } }, { status: 500 }),
      ),
    )
    render(<NotesPage />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'Create note' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'first note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not create note.'))
  })
})
