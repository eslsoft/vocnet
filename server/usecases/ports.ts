import type { Note } from '@shared/types'

export interface NotesPage {
  items: Note[]
  /** Pass back as `cursor` to fetch the next page; null when there are no more. */
  nextCursor: string | null
}

// Interfaces for everything beyond the process boundary. Implemented in adapters/.
export interface NotesRepo {
  list(ownerId: string, opts: { limit: number; cursor?: string }): Promise<NotesPage>
  create(note: Note, ownerId: string): Promise<void>
}

export interface AuthUser {
  sub: string
  email: string | null
  name: string | null
}

export interface AuthVerifier {
  /** Verifies a bearer token or throws InvalidCredentialError. */
  verify(token: string): Promise<AuthUser>
}

export interface Clock {
  now(): Date
}

export interface IdGenerator {
  next(): string
}
