import type { ConsoleStats } from '@shared/monitor'
import { AlertTriangle, ChevronRight, Hand, Hourglass, MessageSquareWarning, TimerOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { clearRange, daysToClear, useWorkSummary } from '@/features/tasks'
import { cn } from '@/shared/lib/cn'
import { formatDuration, formatNumber, formatPercent, formatRelative, formatSigned } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { PageHeader } from '@/shared/ui/page-header'
import { Progress } from '@/shared/ui/progress'
import { StatCard } from '@/shared/ui/stat-card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip'
import { useConsoleStats } from './hooks'
import { entryTotal, type FactTypeRow, factTypeRows, flaggedTotal, REVIEW_SLA_MS } from './stats'

function useFormat() {
  const { i18n } = useTranslation()
  return {
    number: (value: number) => formatNumber(value, i18n.language),
    percent: (value: number) => formatPercent(value, i18n.language, 1),
  }
}

function OpenTasksCard({ stats }: { stats: ConsoleStats }) {
  const { t, i18n } = useTranslation()
  const { number } = useFormat()
  const summary = useWorkSummary('24h')
  const forecast = summary.data?.forecast
  const a1 = forecast?.by_level.find((row) => row.level === 'A1')
  const a1Days = a1 ? daysToClear(a1.open, a1.net_per_day) : undefined
  const range = forecast ? clearRange(stats.work.open, forecast, Date.now()) : null
  return (
    <StatCard
      label={t('overview.openTasks')}
      value={number(stats.work.open)}
      badge={
        a1Days === undefined ? null : a1Days === null ? (
          <Badge variant="destructive">{t('overview.a1Growing')}</Badge>
        ) : (
          <Badge variant="success">{t('overview.a1Done', { count: Math.max(1, Math.round(a1Days)) })}</Badge>
        )
      }
    >
      <ErrorNotice error={summary.error} />
      {forecast ? (
        <span>
          {t('overview.netPerDay', { net: formatSigned(-forecast.net_per_day, i18n.language) })}
          {' · '}
          {range ? t('overview.allDone', { count: Math.max(1, Math.round(range.days)) }) : t('overview.notShrinking')}
        </span>
      ) : null}
    </StatCard>
  )
}

function PendingCard({ stats }: { stats: ConsoleStats }) {
  const { t } = useTranslation()
  const { number } = useFormat()
  const { pending_review: pending } = stats
  const waited = pending.oldest_at === null ? null : Date.now() - new Date(pending.oldest_at).getTime()
  return (
    <StatCard
      label={t('overview.pendingReview')}
      value={number(pending.count)}
      badge={
        waited !== null && waited > REVIEW_SLA_MS ? <Badge variant="warning">{t('overview.overOneHour')}</Badge> : null
      }
    >
      {waited === null
        ? t('overview.nothingWaiting')
        : t('overview.oldest', { duration: formatDuration(waited / 1000) })}
    </StatCard>
  )
}

function Headline({ stats }: { stats: ConsoleStats }) {
  const { t } = useTranslation()
  const { number, percent } = useFormat()
  const flagged = flaggedTotal(stats)
  const quality = stats.live_facts === 0 ? 1 : 1 - flagged / stats.live_facts
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label={t('overview.completeness')} value={percent(stats.completeness.average)}>
        <Progress value={stats.completeness.average * 100} aria-label={t('overview.completeness')} />
        <span>{t('overview.averageAcross', { count: entryTotal(stats), formatted: number(entryTotal(stats)) })}</span>
      </StatCard>
      <StatCard label={t('overview.quality')} value={percent(quality)}>
        <Progress value={quality * 100} aria-label={t('overview.quality')} />
        <span>{t('overview.flaggedOf', { flagged: number(flagged), live: number(stats.live_facts) })}</span>
      </StatCard>
      <OpenTasksCard stats={stats} />
      <PendingCard stats={stats} />
    </div>
  )
}

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', null] as const

function CompletenessByLevel({ stats }: { stats: ConsoleStats }) {
  const { t } = useTranslation()
  const { number, percent } = useFormat()
  const rows = LEVELS.flatMap((level) => stats.completeness.by_level.filter((row) => row.level === level))
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('overview.byLevel')}</CardTitle>
        <CardDescription>{t('overview.byLevelHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const label = row.level ?? t('overview.noLevel')
            return (
              <li
                key={label}
                className="grid grid-cols-[6rem_1fr_4rem] items-center gap-3 text-sm sm:grid-cols-[7rem_1fr_4rem_9rem]"
              >
                <span>{label}</span>
                <Progress value={row.average * 100} aria-label={label} />
                <span className="text-right tabular-nums">{percent(row.average)}</span>
                <span className="hidden text-right text-muted-foreground text-xs tabular-nums sm:block">
                  {t('overview.completeOf', { complete: number(row.complete), entries: number(row.entries) })}
                </span>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

function AttentionRow({
  to,
  icon,
  label,
  count,
  variant,
}: {
  to: string
  icon: ReactNode
  label: string
  count: number
  variant: 'warning' | 'destructive' | 'info' | 'muted'
}) {
  const { number } = useFormat()
  return (
    <li>
      <Link
        to={to}
        className="flex items-center gap-3 rounded-md px-1 py-2.5 text-sm hover:bg-muted [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground"
      >
        {icon}
        <span className="flex-1">{label}</span>
        <Badge variant={count === 0 ? 'muted' : variant}>{number(count)}</Badge>
        <ChevronRight aria-hidden />
      </Link>
    </li>
  )
}

function NeedsAttention({ stats }: { stats: ConsoleStats }) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('overview.attention')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          <AttentionRow
            to="/console/facts?flagged=true"
            icon={<AlertTriangle aria-hidden />}
            label={t('overview.flaggedFacts')}
            count={flaggedTotal(stats)}
            variant="warning"
          />
          <AttentionRow
            to="/console/tasks/activity?result=stuck"
            icon={<Hand aria-hidden />}
            label={t('overview.stuckTasks')}
            count={stats.work.stuck}
            variant="destructive"
          />
          <AttentionRow
            to="/console/tickets"
            icon={<MessageSquareWarning aria-hidden />}
            label={t('overview.openTickets')}
            count={stats.feedback.open}
            variant="warning"
          />
          <AttentionRow
            to="/console/tasks"
            icon={<TimerOff aria-hidden />}
            label={t('overview.timedOut')}
            count={stats.work.timed_out_24h}
            variant="muted"
          />
          <AttentionRow
            to="/console/facts?status=pending"
            icon={<Hourglass aria-hidden />}
            label={t('overview.slowReview')}
            count={stats.pending_review.over_one_hour}
            variant="info"
          />
        </ul>
      </CardContent>
    </Card>
  )
}

const SEGMENTS = [
  { key: 'published', className: 'bg-primary', query: 'status=published' },
  { key: 'flagged', className: 'bg-warning', query: 'flagged=true' },
  { key: 'pending', className: 'bg-info', query: 'status=pending' },
  { key: 'rejected', className: 'bg-muted-foreground/40', query: 'status=rejected' },
] as const

function Distribution({ row, max }: { row: FactTypeRow; max: number }) {
  const { t } = useTranslation()
  const { number } = useFormat()
  const kind = t(`factKind.${row.kind}`)
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full" style={{ width: `${(row.total / max) * 100}%` }}>
      {SEGMENTS.map((segment) => {
        if (row[segment.key] === 0) return null
        const label = t('overview.segment', {
          kind,
          count: number(row[segment.key]),
          status: t(`overview.segments.${segment.key}`),
        })
        return (
          <Tooltip key={segment.key}>
            <TooltipTrigger
              render={
                <Link
                  to={`/console/facts?kind=${row.kind}&${segment.query}`}
                  aria-label={label}
                  className={cn('h-full hover:opacity-80', segment.className)}
                  style={{ width: `${(row[segment.key] / row.total) * 100}%` }}
                />
              }
            />
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

function FactsByType({ stats }: { stats: ConsoleStats }) {
  const { t } = useTranslation()
  const { number } = useFormat()
  const rows = factTypeRows(stats)
  const max = Math.max(1, ...rows.map((row) => row.total))
  return (
    <Card>
      <CardHeader className="sm:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-1">
          <CardTitle>{t('overview.byType')}</CardTitle>
          <CardDescription>{t('overview.byTypeHint')}</CardDescription>
        </div>
        <ul className="flex flex-wrap gap-3 text-muted-foreground text-xs sm:justify-end">
          {SEGMENTS.map((segment) => (
            <li key={segment.key} className="flex items-center gap-1.5">
              <span aria-hidden className={cn('size-2 rounded-sm', segment.className)} />
              {t(`overview.segments.${segment.key}`)}
            </li>
          ))}
        </ul>
      </CardHeader>
      <CardContent>
        <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('overview.type')}</TableHead>
                <TableHead className="w-1/2">{t('overview.distribution')}</TableHead>
                <TableHead className="text-right">{t('overview.segments.flagged')}</TableHead>
                <TableHead className="text-right">{t('overview.segments.pending')}</TableHead>
                <TableHead className="text-right">{t('overview.total')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.kind}>
                  <TableCell>{t(`factKind.${row.kind}`)}</TableCell>
                  <TableCell>
                    <Distribution row={row} max={max} />
                  </TableCell>
                  <TableCell
                    className={cn('text-right tabular-nums', row.flagged > 0 && 'font-medium text-warning-foreground')}
                  >
                    {number(row.flagged)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">{number(row.pending)}</TableCell>
                  <TableCell className="text-right tabular-nums">{number(row.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TooltipProvider>
      </CardContent>
    </Card>
  )
}

/** How complete and reliable the dictionary is, how fast it improves, and what needs a look. */
export function Overview() {
  const { t, i18n } = useTranslation()
  const stats = useConsoleStats()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('overview.title')}
        subtitle={t('overview.subtitle')}
        actions={
          stats.data ? (
            <span className="text-muted-foreground text-xs">
              {t('overview.updated', {
                when: formatRelative(new Date(stats.dataUpdatedAt).toISOString(), i18n.language),
              })}
            </span>
          ) : null
        }
      />
      <ErrorNotice error={stats.error} />
      {stats.data ? (
        <>
          <Headline stats={stats.data} />
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
            <CompletenessByLevel stats={stats.data} />
            <NeedsAttention stats={stats.data} />
          </div>
          <FactsByType stats={stats.data} />
        </>
      ) : null}
    </div>
  )
}
