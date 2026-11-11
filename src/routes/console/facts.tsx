import { FactsBrowser } from '@/features/facts'
import { flaggedTotal, useConsoleStats } from '@/features/overview'

export default function FactsPage() {
  const stats = useConsoleStats()
  return <FactsBrowser flagged={stats.data ? flaggedTotal(stats.data) : undefined} />
}
