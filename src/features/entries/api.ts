import { managedEntrySchema } from '@shared/catalog'
import { decodeApiResponse, rpc } from '@/shared/api/client'

export async function getManagedEntry(lemma: string) {
  return decodeApiResponse(await rpc.manage.v1.entries[':lemma'].$get({ param: { lemma } }), managedEntrySchema)
}
