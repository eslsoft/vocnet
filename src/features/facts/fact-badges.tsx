import type { FactDto, FactStatus } from '@shared/facts'
import { AlertTriangle, CircleCheck, CircleDashed, CircleX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { formatPercent } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/badge'
import { type ReviewSignal, reviewSignal } from './review-signal'

const statusClass: Record<FactStatus, string> = {
  pending: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  published: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rejected: 'border-destructive/40 bg-destructive/10 text-destructive',
  superseded: 'border-border text-muted-foreground line-through',
  retracted: 'border-border text-muted-foreground',
}

export function FactStatusBadge({ status }: { status: FactStatus }) {
  const { t } = useTranslation()
  return (
    <Badge variant="outline" className={statusClass[status]}>
      {t(`factStatus.${status}`)}
    </Badge>
  )
}

const signalStyle: Record<ReviewSignal, { icon: typeof CircleCheck; className: string }> = {
  unreviewed: { icon: CircleDashed, className: 'border-border text-muted-foreground' },
  confident: { icon: CircleCheck, className: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300' },
  flagged: {
    icon: AlertTriangle,
    className: 'border-amber-500/60 bg-amber-500/15 font-semibold text-amber-800 dark:text-amber-300',
  },
  failed: { icon: CircleX, className: 'border-destructive/40 text-destructive' },
}

/** The review at a glance. Flagged reviews are loud on purpose: they are published with flaws. */
export function ReviewSignalBadge({ fact }: { fact: Pick<FactDto, 'review'> }) {
  const { t, i18n } = useTranslation()
  const signal = reviewSignal(fact)
  const { icon: Icon, className } = signalStyle[signal]
  const confidence = fact.review ? formatPercent(fact.review.confidence, i18n.language) : ''
  return (
    <Badge variant="outline" className={cn(className)} data-signal={signal}>
      <Icon aria-hidden />
      {t(`signal.${signal}`, { confidence })}
    </Badge>
  )
}

/** Row tint for facts whose review is flagged, so they stand out in any list. */
export function signalRowClass(fact: Pick<FactDto, 'review'>): string {
  return reviewSignal(fact) === 'flagged' ? 'bg-amber-500/10 shadow-[inset_3px_0_0] shadow-amber-500' : ''
}
