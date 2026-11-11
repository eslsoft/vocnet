import { factStatusSchema } from '@shared/facts'
import { CircleCheck, CircleX, Hourglass, MessageSquareWarning } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { useStats } from './hooks'
import { statsGrid } from './stats-grid'

function CountLink({ count, query }: { count: number; query: string }) {
  const { i18n } = useTranslation()
  if (count === 0) return <span className="text-muted-foreground/60">0</span>
  return (
    <Link className="font-medium tabular-nums underline-offset-4 hover:underline" to={`/console/facts?${query}`}>
      {new Intl.NumberFormat(i18n.language).format(count)}
    </Link>
  )
}

function Tile({
  label,
  value,
  to,
  hint,
  icon: Icon,
}: {
  label: string
  value: number
  to: string
  hint: string
  icon: typeof MessageSquareWarning
}) {
  const { i18n } = useTranslation()
  return (
    <Link to={to} className="group flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs hover:border-primary/50">
      <span className="flex items-center gap-2 text-muted-foreground text-xs">
        <Icon aria-hidden="true" className="size-4 text-primary" />
        {label}
      </span>
      <span className="font-semibold text-3xl tabular-nums tracking-tight group-hover:text-primary">
        {new Intl.NumberFormat(i18n.language).format(value)}
      </span>
      <span className="text-muted-foreground text-xs">{hint}</span>
    </Link>
  )
}

export function Overview() {
  const { t, i18n } = useTranslation()
  const stats = useStats()
  if (stats.error) return <ErrorNotice error={stats.error} />
  if (!stats.data) return null
  const grid = statsGrid(stats.data)
  const statuses = factStatusSchema.options
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          icon={CircleCheck}
          label={t('factStatus.published')}
          value={grid.totals.published}
          to="/console/facts?status=published"
          hint={t('overview.publishedHint')}
        />
        <Tile
          icon={Hourglass}
          label={t('factStatus.pending')}
          value={grid.totals.pending}
          to="/console/facts?status=pending"
          hint={t('overview.pendingHint')}
        />
        <Tile
          icon={CircleX}
          label={t('factStatus.rejected')}
          value={grid.totals.rejected}
          to="/console/facts?status=rejected"
          hint={t('overview.rejectedHint')}
        />
        <Tile
          icon={MessageSquareWarning}
          label={t('overview.openFeedback')}
          value={stats.data.open_feedback}
          to="/console/feedback?status=open"
          hint={t('overview.openFeedbackHint')}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('overview.byKind')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('overview.kind')}</TableHead>
                {statuses.map((status) => (
                  <TableHead key={status} className="text-right">
                    {t(`factStatus.${status}`)}
                  </TableHead>
                ))}
                <TableHead className="text-right">{t('overview.total')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grid.rows.map((row) => (
                <TableRow key={row.kind}>
                  <TableCell>{t(`factKind.${row.kind}`)}</TableCell>
                  {statuses.map((status) => (
                    <TableCell key={status} className="text-right">
                      <CountLink count={row.counts[status]} query={`kind=${row.kind}&status=${status}`} />
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    <CountLink count={row.total} query={`kind=${row.kind}`} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>{t('overview.total')}</TableCell>
                {statuses.map((status) => (
                  <TableCell key={status} className="text-right">
                    <CountLink count={grid.totals[status]} query={`status=${status}`} />
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">
                  {new Intl.NumberFormat(i18n.language).format(grid.total)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
