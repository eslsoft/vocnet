import type { ListedTicketDto, TicketId, TicketStatus } from '@shared/tickets'
import { ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { FactClaim, FactFlagBadge, FactStatusBadge } from '@/features/facts'
import { gapText, SettleSlotDialog, TaskStatusBadge, taskPath, useTasks } from '@/features/tasks'
import { formatStamp } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/badge'
import { buttonVariants } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { useTicket } from './hooks'
import { ResolveTicketDialog } from './resolve-dialog'
import { useTicketTarget } from './target'

const STATUS_VARIANT: Record<TicketStatus, 'warning' | 'success' | 'muted'> = {
  open: 'warning',
  resolved: 'success',
  dismissed: 'muted',
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
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

/** The open tasks about the ticket's entry or sense, each of which a curator can settle by hand. */
function TargetTasks({ subjectId }: { subjectId: string }) {
  const { t } = useTranslation()
  const tasks = useTasks({ subject_id: subjectId })
  if (tasks.error) return <ErrorNotice error={tasks.error} />
  const items = tasks.data?.items ?? []
  if (items.length === 0) return <p className="text-muted-foreground text-sm">{t('tickets.noTasks')}</p>
  return (
    <ul className="flex flex-col gap-2">
      {items.map((task) => (
        <li key={task.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
          <Link to={taskPath(task.id)} className="flex min-w-0 flex-1 flex-col hover:underline">
            <span className="font-medium">{t(`taskType.${task.type}`)}</span>
            <span className="text-muted-foreground text-xs">{gapText(task.gap, t)}</span>
          </Link>
          <TaskStatusBadge status={task.status} />
          <SettleSlotDialog task={task} />
        </li>
      ))}
    </ul>
  )
}

function Detail({ ticket }: { ticket: ListedTicketDto }) {
  const { t, i18n } = useTranslation()
  const target = useTicketTarget(ticket)
  const none = '—'
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold font-serif text-3xl">{ticket.entry?.lemma ?? ticket.target}</h2>
        <TicketStatusBadge status={ticket.status} />
        <Badge variant="outline">{t(`tickets.types.${ticket.type}`)}</Badge>
        <span className="ml-auto flex gap-2">
          {ticket.entry ? (
            <Link
              to={`/console/entries/${encodeURIComponent(ticket.entry.lemma)}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <ArrowUpRight aria-hidden />
              {t('factDetail.openEntry')}
            </Link>
          ) : null}
          {ticket.status === 'open' ? <ResolveTicketDialog ticketId={ticket.id} /> : null}
        </span>
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
            {target.fact ? (
              <FactClaim fact={target.fact} />
            ) : (
              <span className="font-serif">{ticket.entry?.lemma ?? ticket.target}</span>
            )}
          </div>
          {target.fact ? (
            <span className="flex gap-1.5">
              <FactStatusBadge status={target.fact.status} />
              <FactFlagBadge fact={target.fact} />
            </span>
          ) : null}
        </div>
      </section>
      {ticket.status === 'open' && (ticket.target_type === 'entry' || ticket.target_type === 'sense') ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium">{t('tickets.tasks')}</h3>
          <TargetTasks subjectId={ticket.target} />
        </section>
      ) : null}
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">{t('tickets.resolution')}</h3>
        <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
          <Field label={t('tickets.reported')}>{formatStamp(ticket.created_at, i18n.language)}</Field>
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
    </div>
  )
}

/** One ticket read by id, so a deep link works whatever the list shows. */
export function TicketDetail({ ticketId }: { ticketId: TicketId }) {
  const ticket = useTicket(ticketId)
  if (ticket.error) return <ErrorNotice error={ticket.error} />
  if (!ticket.data) return null
  return <Detail ticket={ticket.data} />
}
