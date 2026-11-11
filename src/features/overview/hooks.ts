import { useQuery } from '@tanstack/react-query'
import { getConsoleStats } from './api'

// Agents keep producing while the admin watches, so the counts refresh themselves.
const WATCH_INTERVAL_MS = 60_000

export function useConsoleStats() {
  return useQuery({ queryKey: ['stats'], queryFn: getConsoleStats, refetchInterval: WATCH_INTERVAL_MS })
}
