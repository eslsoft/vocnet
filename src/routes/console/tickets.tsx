import { useConsoleStats } from '@/features/overview'
import { TicketsBrowser } from '@/features/tickets'

export default function TicketsPage() {
  const stats = useConsoleStats()
  return <TicketsBrowser counts={stats.data?.tickets} />
}
