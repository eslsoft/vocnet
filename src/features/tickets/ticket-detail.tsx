import type { FeedbackId, FeedbackStatus, ListedFeedbackDto } from '@shared/feedback'
import { ArrowUpRight, Eye } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { FactClaim, FactFlagBadge, FactStatusBadge } from '@/features/facts'
import { usePrincipalName } from '@/features/keys'
import { TaskStatusBadge, taskPath, useTasks } from '@/features/tasks'
import { formatStamp } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/badge'
import { buttonVariants } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { useTicket } from './hooks'
import { useTicketTarget } from './target'

const STATUS_VARIANT: Record<FeedbackStatus, 'warning' | 'info' | 'success' | 'muted'> = {
  open: 'warning',
  claimed: 'info',
  resolved: 'success',
  dismissed: 'muted',
}

export function TicketStatusBadge({ status }: { status: FeedbackStatus }) {
  const { t } = useTranslation()
  return <Badge variant={STATUS_VARIANT[status]}>{t(`tickets.statuses.${status}`)}</Badge>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}

/** The task fixing the fact a ticket reports, as one line. */
function TicketTask({ factId }: { factId: string }) {
  const { t } = useTranslation()
  const tasks = useTasks({ subject_id: factId })
  const task = tasks.data?.items[0]
  if (tasks.error) return <ErrorNotice error={tasks.error} />
  if (!task) return <span>—</span>
  return (
    <Link to={taskPath(task.id)} className="inline-flex items-center gap-2 underline-offset-4 hover:underline">
      {t(`taskType.${task.type}`)}
      <TaskStatusBadge status={task.status} />
    </Link>
  )
}

function Detail({ ticket }: { ticket: ListedFeedbackDto }) {
  const { t, i18n } = useTranslation()
  const nameOf = usePrincipalName()
  const target = useTicketTarget(ticket)
  const none = '—'
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold font-serif text-3xl">{ticket.entry.lemma}</h2>
        <TicketStatusBadge status={ticket.status} />
        <Link
          to={`/console/entries/${encodeURIComponent(ticket.entry.lemma)}`}
          className={buttonVariants({ variant: 'outline', size: 'sm', className: 'ml-auto' })}
        >
          <ArrowUpRight aria-hidden />
          {t('factDetail.openEntry')}
        </Link>
      </div>
      <ErrorNotice error={target.error} />
      <blockquote className="whitespace-pre-wrap rounded-r-xl border-primary border-l-4 bg-muted p-4 font-serif text-lg leading-relaxed">
        {ticket.message}
      </blockquote>
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">{t(`tickets.about.${ticket.target_type}`)}</h3>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-muted-foreground text-xs">{target.label}</span>
            {target.fact ? <FactClaim fact={target.fact} /> : <span className="font-serif">{ticket.entry.lemma}</span>}
          </div>
          {target.fact ? (
            <span className="flex gap-1.5">
              <FactStatusBadge status={target.fact.status} />
              <FactFlagBadge fact={target.fact} />
            </span>
          ) : null}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">{t('tickets.resolution')}</h3>
        <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
          <Field label={t('tickets.reported')}>{formatStamp(ticket.created_at, i18n.language)}</Field>
          <Field label={t('tickets.task')}>
            {ticket.target_type === 'fact' ? <TicketTask factId={ticket.target_id} /> : none}
          </Field>
          <Field label={t('tickets.assignee')}>{ticket.assignee ? nameOf(ticket.assignee) : none}</Field>
          <Field label={t('tickets.note')}>{ticket.resolution_note ?? none}</Field>
          <Field label={t('tickets.fixes')}>
            {ticket.resolution_fact_ids.length === 0 ? (
              none
            ) : (
              <span className="flex flex-col gap-1">
                {ticket.resolution_fact_ids.map((id) => (
                  <Link
                    key={id}
                    className="font-mono text-xs underline-offset-4 hover:underline"
                    to={`/console/facts?fact=${id}`}
                  >
                    {id}
                  </Link>
                ))}
              </span>
            )}
          </Field>
        </dl>
      </section>
      <p className="flex items-center gap-2 text-muted-foreground text-xs">
        <Eye aria-hidden className="size-4" />
        {t('tickets.readOnly')}
      </p>
    </div>
  )
}

/** One ticket read by id, so a deep link works whatever the list shows. */
export function TicketDetail({ ticketId }: { ticketId: FeedbackId }) {
  const ticket = useTicket(ticketId)
  if (ticket.error) return <ErrorNotice error={ticket.error} />
  if (!ticket.data) return null
  return <Detail ticket={ticket.data} />
}
