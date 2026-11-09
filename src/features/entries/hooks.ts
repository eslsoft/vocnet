import { useQuery } from '@tanstack/react-query'
import { getManagedEntry } from './api'

export function useManagedEntry(lemma: string) {
  return useQuery({ queryKey: ['entry', lemma], queryFn: () => getManagedEntry(lemma), retry: false })
}
