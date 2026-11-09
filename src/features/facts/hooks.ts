import type { FactId } from '@shared/facts'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FactFilter, getFact, listFacts, locateNode, rereviewFact, retractFact } from './api'

export function useFactPages(filter: FactFilter) {
  return useInfiniteQuery({
    queryKey: ['facts', filter],
    queryFn: ({ pageParam }) => listFacts(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
}

export function useFact(id: FactId | null) {
  return useQuery({ queryKey: ['fact', id], queryFn: () => getFact(id as FactId), enabled: id !== null })
}

export function useNodeLocation(id: string) {
  return useQuery({ queryKey: ['node', id], queryFn: () => locateNode(id), staleTime: Number.POSITIVE_INFINITY })
}

// A status change shows up in lists, the entry inspector, and the overview counts.
function useFactMutation(action: (id: FactId) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: action,
    onSuccess: () =>
      Promise.all(['facts', 'fact', 'entry', 'stats'].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))),
  })
}

export const useRetractFact = () => useFactMutation(retractFact)
export const useRereviewFact = () => useFactMutation(rereviewFact)
