import { useAgents } from './hooks'

/**
 * Shows a principal ref the way an admin knows it: an agent by the name its key was issued
 * under. Admin refs and agents not in the list read as the ref itself.
 */
export function usePrincipalName(): (ref: string) => string {
  const agents = useAgents()
  const names = new Map(agents.data?.items.map((agent) => [`agent:${agent.id}`, agent.name]))
  return (ref) => names.get(ref) ?? ref
}

/** The agents an admin can filter by, as principal refs with their names. */
export function useAgentOptions(): Array<{ value: string; label: string }> {
  const agents = useAgents()
  return (agents.data?.items ?? []).map((agent) => ({ value: `agent:${agent.id}`, label: agent.name }))
}
