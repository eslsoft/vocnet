import { type CreateNoteInput, createNoteResponseSchema, notesPageSchema } from '@shared/types'
import { decodeApiResponse, rpc } from '@/shared/api/client'

export async function listNotes(cursor?: string) {
  const response = await rpc.notes.$get({ query: cursor ? { cursor } : {} })
  return decodeApiResponse(response, notesPageSchema)
}

export async function createNote(input: CreateNoteInput) {
  const response = await rpc.notes.$post({ json: input })
  return (await decodeApiResponse(response, createNoteResponseSchema)).item
}
