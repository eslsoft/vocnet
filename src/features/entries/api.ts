import { entrySummaryPageSchema, managedEntrySchema } from '@shared/catalog'
import { decodeApiResponse, rpc } from '@/shared/api/client'

const entries = rpc.manage.v1.entries

export async function listEntries(prefix: string, cursor: string | undefined) {
  const response = await entries.$get({ query: { prefix: prefix || undefined, cursor, limit: '50' } })
  return decodeApiResponse(response, entrySummaryPageSchema)
}

export async function getManagedEntry(lemma: string) {
  return decodeApiResponse(await entries[':lemma'].$get({ param: { lemma } }), managedEntrySchema)
}
