import { z } from 'zod'

// Versioned wire contract shared by the server and browser transport boundary.
// Runtime schemas are authoritative; TypeScript types are inferred from them.
export const noteSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1).max(500),
  createdAt: z.iso.datetime(),
})
export type Note = z.infer<typeof noteSchema>

export const createNoteInputSchema = z.object({ text: z.string().trim().min(1).max(500) })
export type CreateNoteInput = z.infer<typeof createNoteInputSchema>

export const notesPageSchema = z.object({
  items: z.array(noteSchema),
  nextCursor: z.string().nullable(),
})
export type NotesPage = z.infer<typeof notesPageSchema>

export const createNoteResponseSchema = z.object({ item: noteSchema })

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      'authentication_required',
      'invalid_credential',
      'invalid_request',
      'invalid_cursor',
      'internal_error',
    ]),
    message: z.string().min(1),
  }),
})
export type ApiErrorPayload = z.infer<typeof apiErrorSchema>

// Public runtime config the SPA fetches from GET /api/configz. The backend env is
// the single source of truth; only PUBLIC values may be exposed here.
export const clientConfigSchema = z.object({
  oidc: z.object({
    issuer: z.url(),
    clientId: z.string().min(1),
  }),
})
export type ClientConfig = z.infer<typeof clientConfigSchema>
