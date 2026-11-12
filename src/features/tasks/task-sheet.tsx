import type { WorkAttemptDto, WorkItemDetail } from '@shared/monitor'
import { MAX_PASSES, type WorkItemId } from '@shared/work'
import { useTranslation } from 'react-i18next'
import { usePrincipalName } from '@/features/keys'
import { formatDuration, formatRelative, formatStamp } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/badge'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { gapText } from './gap-text'
import { useTask } from './hooks'
import { SettleSlotDialog } from './settle-slot-dialog'
import { AttemptFactBadge, OutcomeBadge, TaskStatusBadge } from './task-badges'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 p-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium text-base tabular-nums">{value}</dd>
    </div>
  )
}

function Attempt({ attempt }: { attempt: WorkAttemptDto }) {
  const { t, i18n } = useTranslation()
  const nameOf = usePrincipalName()
  const stamp = (iso: string) => formatStamp(iso, i18n.language)
  return (
    <li className="relative flex flex-col gap-2 border-l pb-5 pl-5 last:pb-0">
      <span
        aria-hidden
        className="absolute top-1.5 -left-[5px] size-2.5 rounded-full border-2 border-primary bg-card"
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm">{t('activity.tryNumber', { number: attempt.attempt })}</span>
        <span className="font-mono text-sm">{nameOf(attempt.holder)}</span>
        <OutcomeBadge outcome={attempt.outcome} />
        <span className="ml-auto font-mono text-sm tabular-nums">{formatDuration(attempt.seconds)}</span>
      </div>
      <span className="text-muted-foreground text-xs">
        {stamp(attempt.claimed_at)} → {stamp(attempt.completed_at)}
      </span>
      {attempt.facts.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {attempt.facts.map((fact) => (
            <li key={fact.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
              <span className="shrink-0 text-muted-foreground text-xs">{t(`factKind.${fact.kind}`)}</span>
              <span className="min-w-0 flex-1 truncate font-serif italic">{fact.summary}</span>
              <AttemptFactBadge status={fact.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">{t('taskDetail.noFacts')}</p>
      )}
      {attempt.note ? <p className="text-muted-foreground text-sm">{attempt.note}</p> : null}
    </li>
  )
}

function TaskBody({ task }: { task: WorkItemDetail }) {
  const { t, i18n } = useTranslation()
  const nameOf = usePrincipalName()
  return (
    <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
      <div className="rounded-lg bg-muted p-3">
        <p className="text-muted-foreground text-xs">{t('taskDetail.missing')}</p>
        <p className="font-medium">{gapText(task.gap, t)}</p>
      </div>
      {task.lease ? (
        <p className="text-muted-foreground text-sm">
          {t('taskDetail.leased', {
            agent: nameOf(task.lease.holder),
            left: formatRelative(task.lease.expires_at, i18n.language),
          })}
        </p>
      ) : null}
      <dl className="grid grid-cols-2 divide-x divide-y rounded-lg border sm:grid-cols-4 sm:divide-y-0">
        <Stat label={t('taskDetail.created')} value={formatRelative(task.created_at, i18n.language)} />
        <Stat label={t('taskDetail.attempts')} value={String(task.attempts.length)} />
        <Stat label={t('taskDetail.agentTime')} value={formatDuration(task.agent_seconds)} />
        <Stat label={t('taskDetail.queueTime')} value={formatDuration(task.queue_seconds)} />
      </dl>
      <section className="flex flex-col gap-3">
        <h3 className="font-medium">{t('taskDetail.attemptsTitle')}</h3>
        {task.attempts.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('taskDetail.noAttempts')}</p>
        ) : (
          <ol className="flex flex-col pl-1">
            {task.attempts.map((attempt) => (
              <Attempt key={attempt.id} attempt={attempt} />
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

/** One task with every attempt at it, newest first; a curator can settle an open one by hand. */
export function TaskSheet({ taskId, onClose }: { taskId: WorkItemId | null; onClose: () => void }) {
  const { t } = useTranslation()
  const task = useTask(taskId)
  const data = task.data
  return (
    <Sheet open={taskId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="gap-2 border-b pr-12">
          <SheetTitle className="font-normal text-muted-foreground text-xs">
            {data ? t('taskDetail.title', { type: t(`taskType.${data.type}`) }) : t('taskDetail.loading')}
          </SheetTitle>
          {data ? (
            <>
              <SheetDescription render={<div />} className="flex flex-wrap items-baseline gap-2 text-foreground">
                <span className="font-semibold font-serif text-3xl">{data.entry.lemma}</span>
                {data.sense_gloss ? <span className="text-muted-foreground">{data.sense_gloss}</span> : null}
              </SheetDescription>
              <div className="flex flex-wrap items-center gap-2">
                <TaskStatusBadge status={data.status} />
                <Badge variant="outline">
                  {t('taskDetail.tries', { count: data.attempts_without_progress, max: MAX_PASSES })}
                </Badge>
              </div>
            </>
          ) : null}
        </SheetHeader>
        <ErrorNotice error={task.error} className="m-4" />
        {data ? <TaskBody task={data} /> : null}
        {data && data.status !== 'closed' ? (
          <SheetFooter className="flex-row items-center gap-3 border-t bg-muted/50 text-muted-foreground text-xs">
            <span className="flex-1">{t('taskDetail.settleHint')}</span>
            <SettleSlotDialog task={data} />
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
