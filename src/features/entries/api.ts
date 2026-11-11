import { entrySummaryPageSchema } from '@shared/catalog'
import type { CefrLevel } from '@shared/reference'
import { referenceSourceListSchema } from '@shared/reference'
import { decodeApiResponse, rpc } from '@/shared/api/client'

export interface EntryFilter {
  prefix?: string
  level?: CefrLevel
  /** Only entries with a flagged fact. */
  flagged?: 'true'
  /** Only entries with a stuck task. */
  stuck?: 'true'
}

const entries = rpc.manage.v1.entries

export async function listEntries(filter: EntryFilter, cursor: string | undefined) {
  const response = await entries.$get({ query: { ...filter, cursor, limit: '50' } })
  return decodeApiResponse(response, entrySummaryPageSchema)
}

export async function listReferenceSources() {
  return decodeApiResponse(await rpc.manage.v1.sources.$get(), referenceSourceListSchema)
}
