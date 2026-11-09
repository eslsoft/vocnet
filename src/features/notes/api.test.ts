import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { server } from '@/test/msw'
import { createNote, listNotes } from './api'

describe('notes api', () => {
  it('returns the page, with and without a cursor', async () => {
    const page = {
      items: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          text: 'a',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    }
    server.use(http.get('/api/notes', () => HttpResponse.json(page)))
    expect(await listNotes()).toEqual(page)
    expect(await listNotes('cursor-1')).toEqual(page)
  })

  it('throws on a failed list', async () => {
    server.use(
      http.get('/api/notes', () =>
        HttpResponse.json({ error: { code: 'internal_error', message: 'Internal server error.' } }, { status: 500 }),
      ),
    )
    await expect(listNotes()).rejects.toBeInstanceOf(ApiClientError)
  })

  it('throws on a failed create', async () => {
    server.use(
      http.post('/api/notes', () =>
        HttpResponse.json({ error: { code: 'internal_error', message: 'Internal server error.' } }, { status: 500 }),
      ),
    )
    await expect(createNote({ text: 'x' })).rejects.toBeInstanceOf(ApiClientError)
  })
})
