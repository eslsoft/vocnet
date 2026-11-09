import { factStatusSchema } from '@shared/facts'
import { MessageSquareWarning } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { useStats } from './hooks'
import { statsGrid } from './stats-grid'

function CountLink({ count, query }: { count: number; query: string }) {
  if (count === 0) return <span className="text-muted-foreground/60">0</span>
  return (
    <Link className="font-medium tabular-nums underline-offset-4 hover:underline" to={`/facts?${query}`}>
      {count}
    </Link>
  )
}

export function Overview() {
  const { t } = useTranslation()
  const stats = useStats()
  if (stats.error) return <ErrorNotice error={stats.error} />
  if (!stats.data) return null
  const grid = statsGrid(stats.data)
  const statuses = factStatusSchema.options
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
      <Card>
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
                <TableCell className="text-right tabular-nums">{grid.total}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
      <Card className="self-start">
        <CardHeader>
          <CardDescription className="flex items-center gap-2">
            <MessageSquareWarning className="size-4" aria-hidden />
            {t('overview.openFeedback')}
          </CardDescription>
          <CardTitle className="text-3xl tabular-nums">
            <Link to="/feedback?status=open" className="underline-offset-4 hover:underline">
              {stats.data.open_feedback}
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-xs">{t('overview.openFeedbackHint')}</CardContent>
      </Card>
    </div>
  )
}
