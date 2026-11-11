import type { FactDto, FactStatus } from '@shared/facts'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { formatPercent } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/badge'
import { type FactState, factState } from './fact-state'

type Variant = 'success' | 'info' | 'warning' | 'destructive' | 'muted'

const STATUS_VARIANT: Record<FactStatus, Variant> = {
  published: 'success',
  pending: 'info',
  rejected: 'muted',
  superseded: 'muted',
  retracted: 'muted',
}

export function FactStatusBadge({ status }: { status: FactStatus }) {
  const { t } = useTranslation()
  return (
    <Badge variant={STATUS_VARIANT[status]} className={cn(status === 'rejected' && 'line-through')}>
      {t(`factStatus.${status}`)}
    </Badge>
  )
}

/** The flaw of a published fact, or nothing when it has none. */
export function FactFlagBadge({ fact, long = false }: { fact: Pick<FactDto, 'status' | 'review'>; long?: boolean }) {
  const { t, i18n } = useTranslation()
  const state = factState(fact)
  if (state === 'failed') return <Badge variant="destructive">{t('factState.failed')}</Badge>
  if (state !== 'flagged') return null
  const confidence = formatPercent(fact.review?.confidence ?? 0, i18n.language)
  return <Badge variant="warning">{t(long ? 'factState.flaggedLong' : 'factState.flagged', { confidence })}</Badge>
}

/** One badge for lists: the flaw when there is one, else the status. */
export function FactStateBadge({ fact }: { fact: Pick<FactDto, 'status' | 'review'> }) {
  const state: FactState = factState(fact)
  return state === 'flagged' || state === 'failed' ? (
    <FactFlagBadge fact={fact} />
  ) : (
    <FactStatusBadge status={fact.status} />
  )
}
