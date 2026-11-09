import type { Note } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { createNote, listNotes } from './notes'
import type { Clock, IdGenerator, NotesRepo } from './ports'

function createDeps() {
  const stored: Array<{ note: Note; ownerId: string }> = []
  const repo: NotesRepo = {
    list: async () => ({ items: stored.map((row) => row.note), nextCursor: null }),
    create: async (note, ownerId) => {
      stored.push({ note, ownerId })
    },
  }
  const clock: Clock = { now: () => new Date('2026-01-01T00:00:00.000Z') }
  const idGenerator: IdGenerator = { next: () => '00000000-0000-4000-8000-000000000001' }
  return { repo, clock, idGenerator, stored }
}

describe('createNote', () => {
  it('lists notes through the repository [spec: notes/paginate]', async () => {
    const { repo } = createDeps()
    await expect(listNotes(repo, 'owner-1', 20, 'cursor')).resolves.toEqual({ items: [], nextCursor: null })
  })

  it('normalizes the text and persists it for the owner [spec: notes/create]', async () => {
    const { repo, clock, idGenerator, stored } = createDeps()

    const note = await createNote(repo, clock, idGenerator, 'owner-1', { text: '  hi   there ' })

    expect(note.text).toBe('hi there')
    expect(stored).toHaveLength(1)
    expect(stored[0]).toEqual({ note, ownerId: 'owner-1' })
  })

  it('rejects empty text [spec: notes/validate]', async () => {
    const { repo, clock, idGenerator, stored } = createDeps()

    await expect(createNote(repo, clock, idGenerator, 'owner-1', { text: '   ' })).rejects.toThrow('must not be empty')
    expect(stored).toHaveLength(0)
  })
})
