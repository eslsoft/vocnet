import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { type EntryFilter, listEntries, listReferenceSources } from './api'

// Agents keep producing while the admin watches, so the list refreshes itself.
const WATCH_INTERVAL_MS = 30_000

export function useEntryPages(filter: EntryFilter) {
  return useInfiniteQuery({
    queryKey: ['entries', filter],
    queryFn: ({ pageParam }) => listEntries(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchInterval: WATCH_INTERVAL_MS,
  })
}

// Sources change only when an admin reimports them.
export function useReferenceSources() {
  return useQuery({
    queryKey: ['reference-sources'],
    queryFn: listReferenceSources,
    staleTime: Number.POSITIVE_INFINITY,
  })
}
