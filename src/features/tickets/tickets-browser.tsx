import { type FeedbackId, feedbackIdSchema, type ListedFeedbackDto } from '@shared/feedback'
import type { ConsoleStats } from '@shared/monitor'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { cn } from '@/shared/lib/cn'
import { formatNumber, formatRelative } from '@/shared/lib/format'
import { useSearchParamState } from '@/shared/lib/search-params'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { useTicketPages } from './hooks'
import { newestFirst, TAB_STATUSES, TICKET_TABS, type TicketTab, tabCount } from './tabs'
import { TicketDetail } from './ticket-detail'

const tabSchema = z.enum(TICKET_TABS)

// The tab and the selected ticket come from the URL, which is user input.
function useTicketParams() {
  const [params, setParam] = useSearchParamState()
  return {
    tab: tabSchema.safeParse(params.get('tab')).data ?? 'open',
    selected: feedbackIdSchema.safeParse(params.get('ticket')).data ?? null,
    setTab: (tab: TicketTab) => setParam('tab', tab === 'open' ? null : tab),
    select: (id: FeedbackId) => setParam('ticket', id),
  }
}

/** The tickets of a tab: one status, or for Resolved the resolved and dismissed ones together. */
function useTabTickets(tab: TicketTab) {
  const [first, second] = TAB_STATUSES[tab]
  const both = TAB_STATUSES[tab].length > 1
  const primary = useTicketPages(first)
  const secondary = useTicketPages(second, both)
  const queries = both ? [primary, secondary] : [primary]
  return {
    items: newestFirst(queries.flatMap((query) => query.data?.pages.flatMap((page) => page.items) ?? [])),
    error: queries.find((query) => query.error)?.error ?? null,
    loaded: queries.every((query) => query.isSuccess),
    hasMore: queries.some((query) => query.hasNextPage),
    fetching: queries.some((query) => query.isFetchingNextPage),
    loadMore: () => {
      for (const query of queries) if (query.hasNextPage) void query.fetchNextPage()
    },
  }
}

function TicketRow({
  ticket,
  selected,
  onSelect,
}: {
  ticket: ListedFeedbackDto
  selected: boolean
  onSelect: () => void
}) {
  const { t, i18n } = useTranslation()
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
        className={cn(
          'flex w-full flex-col gap-1 border-b border-l-2 border-l-transparent px-4 py-3 text-left hover:bg-muted/60',
          selected && 'border-l-primary bg-accent hover:bg-accent',
        )}
      >
        <span className="flex items-center gap-2">
          <span className="font-semibold font-serif text-base">{ticket.entry.lemma}</span>
          <Badge variant="outline">{t(`tickets.targetType.${ticket.target_type}`)}</Badge>
          <span className="ml-auto shrink-0 text-muted-foreground text-xs">
            {formatRelative(ticket.created_at, i18n.language)}
          </span>
        </span>
        <span className="line-clamp-2 text-sm">{ticket.message}</span>
      </button>
    </li>
  )
}

function TicketList({
  tab,
  selected,
  onSelect,
}: {
  tab: TicketTab
  selected: FeedbackId | null
  onSelect: (id: FeedbackId) => void
}) {
  const { t } = useTranslation()
  const tickets = useTabTickets(tab)
  return (
    <>
      <ErrorNotice error={tickets.error} className="m-4" />
      {tickets.loaded && tickets.items.length === 0 ? (
        <p className="p-4 text-muted-foreground text-sm">{t('tickets.empty')}</p>
      ) : null}
      <ul aria-label={t('tickets.list')}>
        {tickets.items.map((ticket) => (
          <TicketRow
            key={ticket.id}
            ticket={ticket}
            selected={ticket.id === selected}
            onSelect={() => onSelect(ticket.id)}
          />
        ))}
      </ul>
      {tickets.hasMore ? (
        <div className="p-4">
          <Button variant="outline" disabled={tickets.fetching} onClick={tickets.loadMore}>
            {t('common.loadMore')}
          </Button>
        </div>
      ) : null}
    </>
  )
}

/** Problems readers reported, beside the one selected. Read-only: agents resolve tickets through the API. */
export function TicketsBrowser({ counts }: { counts?: ConsoleStats['feedback'] }) {
  const { t, i18n } = useTranslation()
  const { tab, selected, setTab, select } = useTicketParams()
  return (
    <div className="grid overflow-hidden rounded-xl border bg-card lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(tabSchema.parse(value))}
        className="flex min-w-0 flex-col gap-0 pt-4 lg:max-h-[calc(100dvh-4rem)] lg:border-r"
      >
        <div className="flex flex-col gap-3 border-b px-4 pb-4">
          <h1 className="font-semibold text-2xl tracking-tight">{t('tickets.title')}</h1>
          <TabsList>
            {TICKET_TABS.map((value) => (
              <TabsTrigger key={value} value={value} className="px-3">
                {counts
                  ? t('tickets.tabCount', {
                      tab: t(`tickets.tabs.${value}`),
                      count: formatNumber(tabCount(value, counts), i18n.language),
                    })
                  : t(`tickets.tabs.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {TICKET_TABS.map((value) => (
          <TabsContent key={value} value={value} className="min-h-0 overflow-y-auto">
            <TicketList tab={value} selected={selected} onSelect={select} />
          </TabsContent>
        ))}
      </Tabs>
      <section
        aria-label={t('tickets.detail')}
        className="min-w-0 border-t p-6 lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:border-t-0"
      >
        {selected ? (
          <TicketDetail ticketId={selected} />
        ) : (
          <p className="text-muted-foreground text-sm">{t('tickets.pick')}</p>
        )}
      </section>
    </div>
  )
}
