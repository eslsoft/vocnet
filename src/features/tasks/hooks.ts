import type { WorkWindow } from '@shared/monitor'
import type { WorkItemId } from '@shared/work'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { type AttemptFilter, getTask, getWorkSummary, listAttempts, listTasks, type TaskScope } from './api'

// Agents keep working while the admin watches, so task views refresh themselves.
const WATCH_INTERVAL_MS = 30_000

export function useWorkSummary(window: WorkWindow) {
  return useQuery({
    queryKey: ['work', 'summary', window],
    queryFn: () => getWorkSummary(window),
    refetchInterval: WATCH_INTERVAL_MS,
  })
}

export function useAttemptPages(filter: AttemptFilter) {
  return useInfiniteQuery({
    queryKey: ['work', 'attempts', filter],
    queryFn: ({ pageParam }) => listAttempts(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchInterval: WATCH_INTERVAL_MS,
  })
}

export function useTasks(scope: TaskScope | null) {
  return useQuery({
    queryKey: ['work', 'items', scope],
    queryFn: () => listTasks(scope as TaskScope),
    enabled: scope !== null,
  })
}

export function useTask(id: WorkItemId | null) {
  return useQuery({ queryKey: ['work', 'item', id], queryFn: () => getTask(id as WorkItemId), enabled: id !== null })
}
