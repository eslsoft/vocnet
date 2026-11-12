import type { ResolveTicketInput, TicketId } from '@shared/tickets'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getTicket, listTickets, resolveTicket, type TicketFilter } from './api'

export function useTicketPages(filter: TicketFilter) {
  return useInfiniteQuery({
    queryKey: ['tickets', filter],
    queryFn: ({ pageParam }) => listTickets(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
}

export function useTicket(id: TicketId | null) {
  return useQuery({ queryKey: ['ticket', id], queryFn: () => getTicket(id as TicketId), enabled: id !== null })
}

/** Closing a ticket moves it between tabs and changes the counts, so lists and stats are read again. */
export function useResolveTicket(id: TicketId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ResolveTicketInput) => resolveTicket(id, input),
    onSuccess: async () => {
      await Promise.all(['ticket', 'tickets', 'stats'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
    },
  })
}
