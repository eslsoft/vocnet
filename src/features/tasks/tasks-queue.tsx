import type { WorkSummary } from '@shared/monitor'
import { useTranslation } from 'react-i18next'
import { usePrincipalName } from '@/features/keys'
import { cn } from '@/shared/lib/cn'
import { formatDate, formatDuration, formatNumber, formatPercent, formatSigned } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { StatCard } from '@/shared/ui/stat-card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import {
  clearRange,
  daysToClear,
  hourlyRates,
  inLevelOrder,
  type KnownForecast,
  knownForecast,
  leaseRemaining,
} from './forecast'
import { useWorkSummary } from './hooks'
import { byStage } from './stages'
import { TaskTypeBadge } from './task-badges'
import { useTaskWindow } from './window'

/** Below this share of settled attempts closing or progressing their task, a type needs a look. */
const LOW_SUCCESS = 0.65
/** Done within a few days is on track; months away is worth a look. */
const SOON_DAYS = 3
const FAR_DAYS = 60

function useNumber() {
  const { i18n } = useTranslation()
  return (value: number, options?: Intl.NumberFormatOptions) => formatNumber(value, i18n.language, options)
}

function QueueStats({ summary }: { summary: WorkSummary }) {
  const { t } = useTranslation()
  const number = useNumber()
  const windowLabel = t(`tasks.windows.short.${summary.window}`)
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard
        label={t('tasks.open')}
        value={number(summary.open.total)}
        badge={<Badge variant="info">+{number(summary.created)}</Badge>}
      >
        {t('tasks.createdIn', { count: summary.created, formatted: number(summary.created), window: windowLabel })}
      </StatCard>
      <StatCard label={t('taskStatus.in_progress')} value={number(summary.open.in_progress)}>
        {t('tasks.agentsWorking', { count: summary.agents })}
      </StatCard>
      <StatCard label={t('taskStatus.waiting_on_review')} value={number(summary.open.waiting_on_review)}>
        {t('tasks.inReviewHint')}
      </StatCard>
      <StatCard label={t('taskStatus.stuck')} value={number(summary.open.stuck)}>
        {t('tasks.stuckHint')}
      </StatCard>
      <StatCard
        label={t('taskStatus.closed')}
        value={number(summary.closed)}
        badge={<Badge variant="success">{windowLabel}</Badge>}
      >
        {summary.median_close_seconds === null
          ? t('tasks.noneClosed')
          : t('tasks.medianClose', { duration: formatDuration(summary.median_close_seconds) })}
      </StatCard>
    </div>
  )
}

function Rate({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={cn('font-semibold text-2xl tabular-nums', className)}>{value}</dd>
    </div>
  )
}

function bucketLabel(start: string, window: WorkSummary['window'], locale: string) {
  const date = new Date(start)
  return window === '24h'
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
    : formatDate(date, locale)
}

function Throughput({ summary }: { summary: WorkSummary }) {
  const { t, i18n } = useTranslation()
  const number = useNumber()
  const rates = hourlyRates(summary, Date.now())
  const buckets = summary.throughput
  const max = Math.max(1, ...buckets.map((bucket) => Math.max(bucket.closed, bucket.created)))
  const tick = Math.max(1, Math.round(buckets.length / 4))
  const decimal = { maximumFractionDigits: 1 }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tasks.throughput')}</CardTitle>
        <CardDescription>{t(`tasks.throughputHint.${summary.window}`)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          <Rate label={t('tasks.closedPerHour')} value={rates ? number(rates.closed, decimal) : '—'} />
          <Rate label={t('tasks.createdPerHour')} value={rates ? number(rates.created, decimal) : '—'} />
          <Rate
            label={t('tasks.netPerHour')}
            value={rates ? formatSigned(Math.round(rates.net), i18n.language) : '—'}
            className={rates === null ? undefined : rates.net <= 0 ? 'text-primary' : 'text-destructive'}
          />
          <Rate
            label={t('tasks.perAgentPerHour')}
            value={rates?.perAgent == null ? '—' : number(rates.perAgent, decimal)}
          />
        </dl>
        <figure className="flex flex-col gap-2">
          <div
            role="img"
            aria-label={t('tasks.chartLabel', { closed: summary.closed, created: summary.created })}
            className="flex h-40 items-end gap-1"
          >
            {buckets.map((bucket) => (
              <div key={bucket.start} className="flex h-full flex-1 items-end justify-center gap-px">
                <span
                  className="w-1/2 rounded-t-sm bg-primary/80"
                  style={{ height: `${(bucket.closed / max) * 100}%` }}
                />
                <span
                  className="w-1/2 rounded-t-sm bg-muted-foreground/35"
                  style={{ height: `${(bucket.created / max) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <figcaption className="flex justify-between text-muted-foreground text-xs tabular-nums">
            {buckets
              .filter((_, index) => index % tick === 0 && index < buckets.length - 1)
              .map((bucket) => (
                <span key={bucket.start}>{bucketLabel(bucket.start, summary.window, i18n.language)}</span>
              ))}
            <span>{t('tasks.now')}</span>
          </figcaption>
          <div className="flex gap-4 text-muted-foreground text-xs">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-sm bg-primary/80" />
              {t('taskStatus.closed')}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-sm bg-muted-foreground/35" />
              {t('tasks.created')}
            </span>
          </div>
        </figure>
      </CardContent>
    </Card>
  )
}

function DoneIn({ days }: { days: number | null }) {
  const { t } = useTranslation()
  if (days === null) return <Badge variant="destructive">{t('tasks.growing')}</Badge>
  if (days === 0) return <Badge variant="success">{t('tasks.done')}</Badge>
  const label = t('tasks.days', { count: Math.max(1, Math.round(days)) })
  if (days <= SOON_DAYS) return <Badge variant="success">{label}</Badge>
  if (days >= FAR_DAYS) return <Badge variant="warning">{label}</Badge>
  return <span className="tabular-nums">{label}</span>
}

function Forecast({ summary }: { summary: WorkSummary }) {
  const { t } = useTranslation()
  const forecast = knownForecast(summary.forecast)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tasks.forecast')}</CardTitle>
        <CardDescription>{t('tasks.forecastHint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {forecast ? (
          <ForecastBody open={summary.open.total} forecast={forecast} />
        ) : (
          <Collecting since={summary.history_since} />
        )}
        <p className="text-muted-foreground text-xs">{t('tasks.forecastNote')}</p>
      </CardContent>
    </Card>
  )
}

/** Shown until the history covers a full day: rates from a few hours would mislead. */
function Collecting({ since }: { since: string | null }) {
  const { t, i18n } = useTranslation()
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted p-3 text-sm">
      <span className="font-medium">{t('tasks.collecting')}</span>
      <span className="text-muted-foreground text-xs">
        {since === null
          ? t('tasks.collectingNothing')
          : t('tasks.collectingSince', { since: formatDate(new Date(since), i18n.language) })}
      </span>
    </div>
  )
}

function ForecastBody({ open, forecast }: { open: number; forecast: KnownForecast }) {
  const { t, i18n } = useTranslation()
  const number = useNumber()
  const range = clearRange(open, forecast, Date.now())
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-muted p-3">
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-sm">{t('tasks.allOpen')}</span>
          <span className="text-muted-foreground">
            {range
              ? t('tasks.rangeHint', {
                  from: formatDate(range.from, i18n.language),
                  to: formatDate(range.to, i18n.language),
                  open: number(open),
                  net: formatSigned(-forecast.net_per_day, i18n.language),
                })
              : t('tasks.growingHint', { net: formatSigned(-forecast.net_per_day, i18n.language) })}
          </span>
        </div>
        <span className="font-semibold text-2xl tabular-nums">
          {range === null
            ? t('tasks.growing')
            : range.days === 0
              ? t('tasks.done')
              : t('tasks.days', { count: Math.max(1, Math.round(range.days)) })}
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('tasks.level')}</TableHead>
            <TableHead className="text-right">{t('tasks.openColumn')}</TableHead>
            <TableHead className="text-right">{t('tasks.netPerDay')}</TableHead>
            <TableHead className="text-right">{t('tasks.doneIn')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {inLevelOrder(forecast.by_level).map((row) => (
            <TableRow key={row.level ?? 'none'}>
              <TableCell>{row.level ?? t('tasks.noLevel')}</TableCell>
              <TableCell className="text-right tabular-nums">{number(row.open)}</TableCell>
              <TableCell
                className={cn('text-right tabular-nums', row.net_per_day <= 0 && row.open > 0 && 'text-destructive')}
              >
                {formatSigned(-row.net_per_day, i18n.language)}
              </TableCell>
              <TableCell className="text-right">
                <DoneIn days={daysToClear(row.open, row.net_per_day)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}

function SuccessRate({ rate }: { rate: number | null }) {
  const { i18n } = useTranslation()
  if (rate === null) return <span className="text-muted-foreground">—</span>
  const low = rate < LOW_SUCCESS
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span aria-hidden className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
        <span
          className={cn('block h-full rounded-full', low ? 'bg-warning' : 'bg-primary')}
          style={{ width: `${rate * 100}%` }}
        />
      </span>
      <span className={cn('w-10 tabular-nums', low && 'font-medium text-warning-foreground')}>
        {formatPercent(rate, i18n.language)}
      </span>
    </span>
  )
}

function TypeTable({ summary }: { summary: WorkSummary }) {
  const { t } = useTranslation()
  const number = useNumber()
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('tasks.task')}</TableHead>
          <TableHead className="text-right">{t('tasks.openColumn')}</TableHead>
          <TableHead className="text-right">{t('tasks.inReview')}</TableHead>
          <TableHead className="text-right">{t('taskStatus.stuck')}</TableHead>
          <TableHead className="text-right">
            {t('tasks.closedIn', { window: t(`tasks.windows.short.${summary.window}`) })}
          </TableHead>
          <TableHead className="text-right">{t('tasks.medianTime')}</TableHead>
          <TableHead className="text-right">{t('tasks.successRate')}</TableHead>
        </TableRow>
      </TableHeader>
      {byStage(summary.by_type).map((group) => (
        <TableBody key={group.stage}>
          <TableRow className="hover:bg-transparent">
            <TableHead colSpan={7} scope="colgroup" className="h-8 bg-surface">
              {t(`stage.${group.stage}`)}
            </TableHead>
          </TableRow>
          {group.rows.map((row) => (
            <TableRow key={row.type}>
              <TableCell>{t(`taskType.${row.type}`)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{number(row.open)}</TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {number(row.waiting_on_review)}
              </TableCell>
              <TableCell className={cn('text-right tabular-nums', row.stuck > 0 && 'font-medium text-destructive')}>
                {number(row.stuck)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{number(row.closed)}</TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {row.median_attempt_seconds === null ? '—' : formatDuration(row.median_attempt_seconds)}
              </TableCell>
              <TableCell className="text-right">
                <SuccessRate rate={row.success_rate} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      ))}
    </Table>
  )
}

function Leases({ leases }: { leases: WorkSummary['leases'] }) {
  const { t } = useTranslation()
  const nameOf = usePrincipalName()
  const now = Date.now()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('taskStatus.in_progress')}</CardTitle>
        <CardDescription>{t('tasks.leasesHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        {leases.length === 0 ? <p className="text-muted-foreground text-sm">{t('tasks.noLeases')}</p> : null}
        <ul className="flex flex-col divide-y">
          {leases.map((lease) => {
            const remaining = leaseRemaining(lease, now)
            const left = Math.max(0, (new Date(lease.expires_at).getTime() - now) / 1000)
            const more = lease.items > lease.lemmas.length ? '…' : ''
            return (
              <li key={lease.id} className="flex flex-col gap-1.5 py-3">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-sm">{nameOf(lease.holder)}</span>
                  <TaskTypeBadge type={lease.type} />
                  <span
                    className={cn(
                      'ml-auto shrink-0 text-xs tabular-nums',
                      lease.timed_out ? 'font-medium text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {lease.timed_out ? t('tasks.timedOut') : t('tasks.left', { duration: formatDuration(left) })}
                  </span>
                </div>
                <span className="truncate text-muted-foreground text-xs">
                  {t('tasks.leaseItems', { count: lease.items })} · {lease.lemmas.join(', ')}
                  {more}
                </span>
                <span aria-hidden className="h-1 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-info" style={{ width: `${remaining * 100}%` }} />
                </span>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

/** How much open work there is, how fast agents close it, and who works on what now. */
export function TasksQueue() {
  const [window] = useTaskWindow()
  const summary = useWorkSummary(window)
  if (summary.error) return <ErrorNotice error={summary.error} />
  if (!summary.data) return null
  return (
    <div className="flex flex-col gap-6">
      <QueueStats summary={summary.data} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <Throughput summary={summary.data} />
        <Forecast summary={summary.data} />
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <TypeTable summary={summary.data} />
        <Leases leases={summary.data.leases} />
      </div>
    </div>
  )
}
