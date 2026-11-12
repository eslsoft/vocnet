import type { FactStatus } from '@shared/facts'
import type { WorkAttemptOutcome, WorkItemStatus } from '@shared/monitor'
import type { WorkType } from '@shared/work'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/shared/ui/badge'

type Variant = 'success' | 'info' | 'progress' | 'warning' | 'destructive' | 'muted' | 'outline'

const STATUS_VARIANT: Record<WorkItemStatus, Variant> = {
  queued: 'muted',
  in_progress: 'progress',
  waiting_on_review: 'info',
  stuck: 'destructive',
  closed: 'success',
}

const OUTCOME_VARIANT: Record<WorkAttemptOutcome, Variant> = {
  waiting_on_review: 'info',
  closed: 'success',
  passed: 'success',
  progressed: 'progress',
  no_progress: 'muted',
  stuck: 'destructive',
}

const FACT_VARIANT: Record<FactStatus, Variant> = {
  pending: 'info',
  published: 'success',
  rejected: 'muted',
  superseded: 'muted',
  retracted: 'muted',
}

export function TaskStatusBadge({ status }: { status: WorkItemStatus }) {
  const { t } = useTranslation()
  return <Badge variant={STATUS_VARIANT[status]}>{t(`taskStatus.${status}`)}</Badge>
}

export function OutcomeBadge({ outcome }: { outcome: WorkAttemptOutcome }) {
  const { t } = useTranslation()
  return <Badge variant={OUTCOME_VARIANT[outcome]}>{t(`outcome.${outcome}`)}</Badge>
}

export function TaskTypeBadge({ type }: { type: WorkType }) {
  const { t } = useTranslation()
  return <Badge variant="outline">{t(`taskType.${type}`)}</Badge>
}

/** A submitted fact's status as an attempt shows it; the facts views add the review on top. */
export function AttemptFactBadge({ status }: { status: FactStatus }) {
  const { t } = useTranslation()
  return <Badge variant={FACT_VARIANT[status]}>{t(`factStatus.${status}`)}</Badge>
}

/** The task as a link target: the activity page opens its detail. */
export const taskPath = (id: string) => `/console/tasks/activity?task=${id}`
