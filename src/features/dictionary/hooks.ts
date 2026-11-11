import { useQuery } from '@tanstack/react-query'
import { listSources } from './api'

// Sources change only when an admin reimports reference data.
export function useSources() {
  return useQuery({ queryKey: ['public', 'sources'], queryFn: listSources, staleTime: Number.POSITIVE_INFINITY })
}
