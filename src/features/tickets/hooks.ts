import type { FeedbackId, FeedbackStatus } from '@shared/feedback'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { getTicket, listTickets } from './api'

export function useTicketPages(status: FeedbackStatus | undefined, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['feedback', status ?? null],
    queryFn: ({ pageParam }) => listTickets(status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled,
  })
}

export function useTicket(id: FeedbackId | null) {
  return useQuery({ queryKey: ['ticket', id], queryFn: () => getTicket(id as FeedbackId), enabled: id !== null })
}
