import type { FactDto, FactId } from '@shared/facts'
import type { WorkItemOverview } from '@shared/monitor'
import { CircleDashed } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { FactClaim, type FactState, FactStateBadge, factState, useNodeLocation } from '@/features/facts'
import { usePrincipalName } from '@/features/keys'
import { gapNeed, TaskStatusBadge, taskPath } from '@/features/tasks'
import { cn } from '@/shared/lib/cn'
import { formatDuration, formatRelative } from '@/shared/lib/format'

const MARK: Record<FactState, string> = {
  published: 'border-l-primary/50',
  pending: 'border-l-info',
  flagged: 'border-l-warning bg-warning/10',
  failed: 'border-l-destructive bg-destructive/5',
  rejected: 'border-l-muted-foreground/30 text-muted-foreground line-through',
  superseded: 'border-l-muted-foreground/30 text-muted-foreground',
  retracted: 'border-l-muted-foreground/30 text-muted-foreground',
}

/** One fact as a typeset line with its state as a colored mark; a published fact needs no badge. */
export function FactRow({ fact, onSelect }: { fact: FactDto; onSelect: (id: FactId) => void }) {
  const state = factState(fact)
  return (
    <button
      type="button"
      onClick={() => onSelect(fact.id)}
      data-state={state}
      className={cn(
        'flex w-full items-center gap-3 rounded-r-md border-l-2 py-1.5 pr-2 pl-3 text-left hover:bg-muted/60',
        MARK[state],
      )}
    >
      <span className="min-w-0 flex-1">
        <FactClaim fact={fact} />
      </span>
      {state === 'published' ? null : (
        <span className="no-underline">
          <FactStateBadge fact={fact} />
        </span>
      )}
    </button>
  )
}

type RelationFact = Extract<FactDto, { kind: 'relation' }>

/** A relation another entry's sense points at this one with. */
export function IncomingRow({ fact, onSelect }: { fact: RelationFact; onSelect: (id: FactId) => void }) {
  const { t } = useTranslation()
  const source = useNodeLocation(fact.subject_id)
  const state = factState(fact)
  const lemma = source.data?.entry.lemma ?? '…'
  return (
    <button
      type="button"
      onClick={() => onSelect(fact.id)}
      data-state={state}
      className={cn(
        'flex w-full items-center gap-3 rounded-r-md border-l-2 py-1.5 pr-2 pl-3 text-left hover:bg-muted/60',
        MARK[state],
      )}
    >
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="text-muted-foreground text-sm">{t(`relationType.${fact.payload.type}`)}</span>
        <span className="font-serif">{lemma}</span>
        <span className="text-muted-foreground text-xs">{t('inspector.linkedFrom', { lemma })}</span>
      </span>
      {state === 'published' ? null : <FactStateBadge fact={fact} />}
    </button>
  )
}

/** An open task in the place the fact it needs would go: what is missing and who is on it. */
export function TaskRow({ task }: { task: WorkItemOverview }) {
  const { t, i18n } = useTranslation()
  const nameOf = usePrincipalName()
  const now = Date.now()
  const who = task.lease
    ? `${nameOf(task.lease.holder)} · ${t('tasks.left', {
        duration: formatDuration(Math.max(0, (new Date(task.lease.expires_at).getTime() - now) / 1000)),
      })}`
    : task.attempts_without_progress > 0
      ? t('inspector.triesWithoutProgress', { count: task.attempts_without_progress })
      : t('inspector.created', { when: formatRelative(task.created_at, i18n.language) })
  return (
    <Link
      to={taskPath(task.id)}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed px-3 py-1.5 text-sm hover:border-primary/50"
    >
      <CircleDashed aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">{gapNeed(task.gap, t)}</span>
      <span className="text-muted-foreground text-xs">
        {t('inspector.taskOf', { type: t(`taskType.${task.type}`) })} · {who}
      </span>
      <TaskStatusBadge status={task.status} />
    </Link>
  )
}
