import type { FeedbackStatus, ListedFeedbackDto } from '@shared/feedback'

/** The views of the ticket list: Assigned is a claimed ticket, Resolved also holds dismissed ones. */
export const TICKET_TABS = ['open', 'assigned', 'resolved', 'all'] as const
export type TicketTab = (typeof TICKET_TABS)[number]

export const TAB_STATUSES: Record<TicketTab, Array<FeedbackStatus | undefined>> = {
  open: ['open'],
  assigned: ['claimed'],
  resolved: ['resolved', 'dismissed'],
  all: [undefined],
}

/** How many tickets a tab lists, from the counts by status. */
export function tabCount(tab: TicketTab, counts: Record<FeedbackStatus, number>): number {
  const statuses = tab === 'all' ? (Object.keys(counts) as FeedbackStatus[]) : (TAB_STATUSES[tab] as FeedbackStatus[])
  return statuses.reduce((sum, status) => sum + counts[status], 0)
}

/** Newest first across the pages of several statuses. */
export function newestFirst(items: ListedFeedbackDto[]): ListedFeedbackDto[] {
  return [...items].sort((a, b) => b.created_at.localeCompare(a.created_at))
}
