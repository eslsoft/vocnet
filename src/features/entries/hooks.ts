import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { getManagedEntry, listEntries, listReferenceSources } from './api'

// Agents keep producing while the admin watches, so the list refreshes itself.
const WATCH_INTERVAL_MS = 30_000

export function useEntryPages(prefix: string) {
  return useInfiniteQuery({
    queryKey: ['entries', prefix],
    queryFn: ({ pageParam }) => listEntries(prefix, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchInterval: WATCH_INTERVAL_MS,
  })
}

export function useManagedEntry(lemma: string) {
  return useQuery({ queryKey: ['entry', lemma], queryFn: () => getManagedEntry(lemma), retry: false })
}

// Sources change only when an admin reimports them.
export function useReferenceSources() {
  return useQuery({
    queryKey: ['reference-sources'],
    queryFn: listReferenceSources,
    staleTime: Number.POSITIVE_INFINITY,
  })
}
