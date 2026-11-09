import { statsSchema } from '@shared/catalog'
import { decodeApiResponse, rpc } from '@/shared/api/client'

export async function getStats() {
  return decodeApiResponse(await rpc.manage.v1.stats.$get(), statsSchema)
}
