import { managedEntryDetailSchema, nodeLocationSchema } from '@shared/catalog'
import { type FactId, type FactKind, type FactStatus, factPageSchema, listedFactSchema } from '@shared/facts'
import type { CefrLevel } from '@shared/reference'
import { decodeApiResponse, rpc } from '@/shared/api/client'

export interface FactFilter {
  status?: FactStatus
  kind?: FactKind
  level?: CefrLevel
  author?: string
  lemma?: string
}

const facts = rpc.manage.v1.facts

export async function listFacts(filter: FactFilter, cursor: string | undefined) {
  const response = await facts.$get({ query: { ...filter, cursor, limit: '25' } })
  return decodeApiResponse(response, factPageSchema)
}

export async function getFact(id: FactId) {
  return decodeApiResponse(await facts[':id'].$get({ param: { id } }), listedFactSchema)
}

export async function locateNode(id: string) {
  return decodeApiResponse(await rpc.manage.v1.nodes[':id'].$get({ param: { id } }), nodeLocationSchema)
}

export async function getManagedEntry(lemma: string) {
  const response = await rpc.manage.v1.entries[':lemma'].$get({ param: { lemma } })
  return decodeApiResponse(response, managedEntryDetailSchema)
}
