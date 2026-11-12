import type { ConsoleStats } from '@shared/monitor'
import type { TicketStatus } from '@shared/tickets'

/** The views of the ticket list: a status each, or every ticket. */
export const TICKET_TABS = ['open', 'resolved', 'dismissed', 'all'] as const
export type TicketTab = (typeof TICKET_TABS)[number]

export const tabStatus = (tab: TicketTab): TicketStatus | undefined => (tab === 'all' ? undefined : tab)

/** How many tickets a tab lists, from the counts by status. */
export function tabCount(tab: TicketTab, counts: ConsoleStats['tickets']): number {
  return tab === 'all' ? counts.open + counts.resolved + counts.dismissed : counts[tab]
}
