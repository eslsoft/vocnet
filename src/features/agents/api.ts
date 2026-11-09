import { type AgentId, agentListSchema, agentSchema, issuedAgentSchema } from '@shared/agents'
import { decodeApiResponse, rpc } from '@/shared/api/client'

const agents = rpc.manage.v1.agents

export async function listAgents() {
  return decodeApiResponse(await agents.$get(), agentListSchema)
}

export async function issueAgent(name: string) {
  return decodeApiResponse(await agents.$post({ json: { name } }), issuedAgentSchema)
}

export async function revokeAgent(id: AgentId) {
  return decodeApiResponse(await agents[':id'].$delete({ param: { id } }), agentSchema)
}
