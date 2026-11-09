import { QueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@/shared/api/client'

const maxRetries = 3

/** A 4xx answer is the server's decision and will not change on retry; network and 5xx failures may. */
export function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiClientError && error.status < 500) return false
  return failureCount < maxRetries
}

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: shouldRetry } } })
}

export const queryClient = createQueryClient()
