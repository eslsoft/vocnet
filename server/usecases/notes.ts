import { normalizeNoteText } from '@server/domain/note'
import type { CreateNoteInput, Note } from '@shared/types'
import type { Clock, IdGenerator, NotesPage, NotesRepo } from './ports'

export function listNotes(repo: NotesRepo, ownerId: string, limit: number, cursor?: string): Promise<NotesPage> {
  return repo.list(ownerId, { limit, cursor })
}

export async function createNote(
  repo: NotesRepo,
  clock: Clock,
  idGenerator: IdGenerator,
  ownerId: string,
  input: CreateNoteInput,
): Promise<Note> {
  const note: Note = {
    id: idGenerator.next(),
    text: normalizeNoteText(input.text),
    createdAt: clock.now().toISOString(),
  }
  await repo.create(note, ownerId)
  return note
}
