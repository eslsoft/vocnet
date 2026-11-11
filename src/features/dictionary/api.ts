import { referenceSourceListSchema } from '@shared/reference'
import { decodeApiResponse, rpc } from '@/shared/api/client'

// The public dictionary reads (/v1). They need no credential, so they work signed out.

export async function listSources() {
  return decodeApiResponse(await rpc.v1.sources.$get(), referenceSourceListSchema)
}
