import type { RelationDomain } from '@shared/facts'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getEntry, listSources, searchEntries } from './api'

export function useEntry(lemma: string, domain: RelationDomain | undefined) {
  return useQuery({ queryKey: ['public', 'entry', lemma, domain ?? null], queryFn: () => getEntry(lemma, domain) })
}

export function useSearch(q: string, limit: number) {
  const query = q.trim()
  return useQuery({
    queryKey: ['public', 'search', query, limit],
    queryFn: () => searchEntries(query, limit),
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
  })
}

// Sources change only when an admin reimports reference data.
export function useSources() {
  return useQuery({ queryKey: ['public', 'sources'], queryFn: listSources, staleTime: Number.POSITIVE_INFINITY })
}
