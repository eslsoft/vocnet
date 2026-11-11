import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { issueAgent, listAgents, revokeAgent } from './api'

export function useAgents() {
  return useQuery({ queryKey: ['agents'], queryFn: listAgents })
}

function useAgentMutation<I, O>(action: (input: I) => Promise<O>) {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: action, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }) })
}

export const useIssueAgent = () => useAgentMutation(issueAgent)
export const useRevokeAgent = () => useAgentMutation(revokeAgent)
