import type { FactId } from '@shared/facts'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { type FactFilter, getFact, getManagedEntry, listFacts, locateNode } from './api'

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

// A node never moves to another entry, so its location is read once.
export function useNodeLocation(id: string | null) {
  return useQuery({
    queryKey: ['node', id],
    queryFn: () => locateNode(id as string),
    enabled: id !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useManagedEntry(lemma: string | null) {
  return useQuery({
    queryKey: ['entry', lemma],
    queryFn: () => getManagedEntry(lemma as string),
    enabled: lemma !== null,
    retry: false,
  })
}
