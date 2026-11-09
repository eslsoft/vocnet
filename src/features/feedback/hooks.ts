import type { FeedbackStatus } from '@shared/feedback'
import { useInfiniteQuery } from '@tanstack/react-query'
import { listFeedback } from './api'

export function useFeedbackPages(status: FeedbackStatus | undefined) {
  return useInfiniteQuery({
    queryKey: ['feedback', status],
    queryFn: ({ pageParam }) => listFeedback(status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
}
