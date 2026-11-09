import type { createDb } from '@server/db/client'
import { notes } from '@server/db/schema'
import { InvalidCursorError } from '@server/usecases/errors'
import type { NotesPage, NotesRepo } from '@server/usecases/ports'
import { and, desc, eq, lt, or } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>

// Opaque keyset cursor over (createdAt, id). The id tiebreaker makes paging stable
// even when rows share a createdAt — a cursor on createdAt alone would drop them.
// createdAt (ISO) and id (uuid) never contain the delimiter.
function encodeCursor(row: { createdAt: string; id: string }): string {
  return `${row.createdAt}|${row.id}`
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = cursor.split('|')
  if (!createdAt || !id) throw new InvalidCursorError()
  return { createdAt, id }
}

export function createNotesRepo(db: Db): NotesRepo {
  return {
    async list(ownerId, { limit, cursor }): Promise<NotesPage> {
      const after = cursor ? decodeCursor(cursor) : undefined
      const keyset = after
        ? or(lt(notes.createdAt, after.createdAt), and(eq(notes.createdAt, after.createdAt), lt(notes.id, after.id)))
        : undefined

      // Fetch one extra row to tell whether a further page exists.
      const rows = await db
        .select({ id: notes.id, text: notes.text, createdAt: notes.createdAt })
        .from(notes)
        .where(and(eq(notes.ownerId, ownerId), keyset))
        .orderBy(desc(notes.createdAt), desc(notes.id))
        .limit(limit + 1)

      const items = rows.slice(0, limit)
      const last = items.at(-1)
      const nextCursor = rows.length > limit && last ? encodeCursor(last) : null
      return { items, nextCursor }
    },
    async create(note, ownerId) {
      await db.insert(notes).values({ ...note, ownerId })
    },
  }
}
