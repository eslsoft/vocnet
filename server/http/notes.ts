import { zValidator } from '@hono/zod-validator'
import { createNote, listNotes } from '@server/usecases/notes'
import { createNoteInputSchema } from '@shared/types'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
})

// Notes are scoped to the authenticated user (c.get('user').sub). Chained so the
// route types flow into AppType for the SPA's RPC client.
export const notesRoutes = new Hono<AppEnv>()
  .get(
    '/notes',
    zValidator('query', listQuerySchema, (result, c) =>
      result.success ? undefined : c.json({ error: { code: 'invalid_request', message: 'Invalid query.' } }, 400),
    ),
    async (c) => {
      const { limit, cursor } = c.req.valid('query')
      return c.json(await listNotes(c.get('deps').notesRepo, c.get('user').sub, limit, cursor))
    },
  )
  .post(
    '/notes',
    zValidator('json', createNoteInputSchema, (result, c) =>
      result.success ? undefined : c.json({ error: { code: 'invalid_request', message: 'Invalid note.' } }, 400),
    ),
    async (c) => {
      const deps = c.get('deps')
      const item = await createNote(
        deps.notesRepo,
        deps.clock,
        deps.idGenerator,
        c.get('user').sub,
        c.req.valid('json'),
      )
      return c.json({ item }, 201)
    },
  )
