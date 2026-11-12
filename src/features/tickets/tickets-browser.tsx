import type { ConsoleStats } from '@shared/monitor'
import { type ListedTicketDto, type TicketId, ticketIdSchema, ticketTypeSchema } from '@shared/tickets'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { cn } from '@/shared/lib/cn'
import { formatNumber, formatRelative } from '@/shared/lib/format'
import { useSearchParamState } from '@/shared/lib/search-params'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { FilterSelect } from '@/shared/ui/filter-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { useTicketPages } from './hooks'
import { TICKET_TABS, type TicketTab, tabCount, tabStatus } from './tabs'
import { TicketDetail } from './ticket-detail'

const tabSchema = z.enum(TICKET_TABS)

// The tab, the type filter, and the selected ticket come from the URL, which is user input.
function useTicketParams() {
  const [params, setParam] = useSearchParamState()
  return {
    tab: tabSchema.safeParse(params.get('tab')).data ?? 'open',
    type: ticketTypeSchema.safeParse(params.get('type')).data,
    selected: ticketIdSchema.safeParse(params.get('ticket')).data ?? null,
    setTab: (tab: TicketTab) => setParam('tab', tab === 'open' ? null : tab),
    setType: (type: string | null) => setParam('type', type),
    select: (id: TicketId) => setParam('ticket', id),
  }
}

function TicketRow({
  ticket,
  selected,
  onSelect,
}: {
  ticket: ListedTicketDto
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
          <span className="font-semibold font-serif text-base">{ticket.entry?.lemma ?? ticket.target}</span>
          <Badge variant="outline">{t(`tickets.types.${ticket.type}`)}</Badge>
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
  type,
  selected,
  onSelect,
}: {
  tab: TicketTab
  type: ListedTicketDto['type'] | undefined
  selected: TicketId | null
  onSelect: (id: TicketId) => void
}) {
  const { t } = useTranslation()
  const pages = useTicketPages({ status: tabStatus(tab), type })
  const items = pages.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <>
      <ErrorNotice error={pages.error} className="m-4" />
      {pages.isSuccess && items.length === 0 ? (
        <p className="p-4 text-muted-foreground text-sm">{t('tickets.empty')}</p>
      ) : null}
      <ul aria-label={t('tickets.list')}>
        {items.map((ticket) => (
          <TicketRow
            key={ticket.id}
            ticket={ticket}
            selected={ticket.id === selected}
            onSelect={() => onSelect(ticket.id)}
          />
        ))}
      </ul>
      {pages.hasNextPage ? (
        <div className="p-4">
          <Button variant="outline" disabled={pages.isFetchingNextPage} onClick={() => pages.fetchNextPage()}>
            {t('common.loadMore')}
          </Button>
        </div>
      ) : null}
    </>
  )
}

/**
 * Everything a curator handles by hand, oldest first, beside the one selected: work its passes did
 * not fill, reader feedback, audit picks, and missing words.
 */
export function TicketsBrowser({ counts }: { counts?: ConsoleStats['tickets'] }) {
  const { t, i18n } = useTranslation()
  const { tab, type, selected, setTab, setType, select } = useTicketParams()
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
          <FilterSelect
            label={t('tickets.type')}
            allLabel={t('common.all')}
            value={type ?? null}
            options={ticketTypeSchema.options.map((value) => ({ value, label: t(`tickets.types.${value}`) }))}
            onChange={setType}
            className="self-start"
          />
        </div>
        {TICKET_TABS.map((value) => (
          <TabsContent key={value} value={value} className="min-h-0 overflow-y-auto">
            <TicketList tab={value} type={type} selected={selected} onSelect={select} />
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
