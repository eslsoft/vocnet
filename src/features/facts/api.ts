import { nodeLocationSchema } from '@shared/catalog'
import { type FactId, type FactKind, type FactStatus, factPageSchema, factSchema } from '@shared/facts'
import { decodeApiResponse, rpc } from '@/shared/api/client'

export interface FactFilter {
  status?: FactStatus
  kind?: FactKind
}

const facts = rpc.manage.v1.facts

export async function listFacts(filter: FactFilter, cursor: string | undefined) {
  const response = await facts.$get({ query: { ...filter, cursor, limit: '25' } })
  return decodeApiResponse(response, factPageSchema)
}

export async function getFact(id: FactId) {
  return decodeApiResponse(await facts[':id'].$get({ param: { id } }), factSchema)
}

export async function retractFact(id: FactId) {
  return decodeApiResponse(await facts[':id'].retract.$post({ param: { id } }), factSchema)
}

export async function rereviewFact(id: FactId) {
  return decodeApiResponse(await facts[':id'].rereview.$post({ param: { id } }), factSchema)
}

export async function locateNode(id: string) {
  return decodeApiResponse(await rpc.manage.v1.nodes[':id'].$get({ param: { id } }), nodeLocationSchema)
}
