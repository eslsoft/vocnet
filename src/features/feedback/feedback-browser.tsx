import { type FeedbackDto, type FeedbackId, feedbackIdSchema, feedbackStatusSchema } from '@shared/feedback'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EntryLink } from '@/features/facts'
import { formatDateTime } from '@/shared/lib/format'
import { useSearchParamState } from '@/shared/lib/search-params'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { SelectField } from '@/shared/ui/select-field'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { useFeedbackPages } from './hooks'

function factLink(id: string) {
  return (
    <Link key={id} className="underline-offset-4 hover:underline" to={`/facts?fact=${id}`}>
      <code className="text-xs">{id}</code>
    </Link>
  )
}

/** A fact target opens the fact; an entry or sense target opens its entry. */
function TargetLink({ item }: { item: FeedbackDto }) {
  return item.target_type === 'fact' ? factLink(item.target_id) : <EntryLink nodeId={item.target_id} />
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function FeedbackDetail({ item }: { item: FeedbackDto }) {
  const { t, i18n } = useTranslation()
  const date = (iso: string | null) => (iso ? formatDateTime(iso, i18n.language) : '—')
  return (
    <div className="flex flex-col gap-5 px-4 pb-6 text-sm">
      <p className="whitespace-pre-wrap rounded-md bg-muted p-3">{item.message}</p>
      <dl className="flex flex-col gap-2">
        <Field label={t('feedback.target')}>
          {t(`feedback.targetType.${item.target_type}`)} · <TargetLink item={item} />
        </Field>
        <Field label={t('feedback.reported')}>{date(item.created_at)}</Field>
        <Field label={t('feedback.assignee')}>{item.assignee ?? '—'}</Field>
        <Field label={t('feedback.claimExpires')}>{date(item.claim_expires_at)}</Field>
        <Field label={t('feedback.resolution')}>{item.resolution_note ?? '—'}</Field>
        <Field label={t('feedback.resolutionFacts')}>
          <div className="flex flex-col gap-1">{item.resolution_fact_ids.map(factLink)}</div>
        </Field>
      </dl>
      <p className="text-muted-foreground text-xs">{t('feedback.readOnly')}</p>
    </div>
  )
}

function useFeedbackParams() {
  const [params, update] = useSearchParamState()
  return {
    status: feedbackStatusSchema.safeParse(params.get('status')).data,
    selected: feedbackIdSchema.safeParse(params.get('item')).data ?? null,
    setStatus: (status: string) => update('status', status),
    select: (id: FeedbackId | null) => update('item', id),
  }
}

export function FeedbackBrowser() {
  const { t, i18n } = useTranslation()
  const { status, selected, setStatus, select } = useFeedbackParams()
  const pages = useFeedbackPages(status)
  const items = pages.data?.pages.flatMap((page) => page.items) ?? []
  const open = items.find((item) => item.id === selected)
  return (
    <div className="flex flex-col gap-4">
      <SelectField
        label={t('facts.status')}
        className="self-start"
        value={status ?? ''}
        onChange={(event) => setStatus(event.target.value)}
      >
        <option value="">{t('common.all')}</option>
        {feedbackStatusSchema.options.map((option) => (
          <option key={option} value={option}>
            {t(`feedback.statuses.${option}`)}
          </option>
        ))}
      </SelectField>
      <ErrorNotice error={pages.error} />
      {pages.isSuccess && items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('feedback.empty')}</p>
      ) : null}
      {items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('facts.status')}</TableHead>
              <TableHead>{t('feedback.target')}</TableHead>
              <TableHead>{t('feedback.message')}</TableHead>
              <TableHead>{t('feedback.reported')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} className="cursor-pointer" onClick={() => select(item.id)}>
                <TableCell>
                  <Badge variant="outline">{t(`feedback.statuses.${item.status}`)}</Badge>
                </TableCell>
                <TableCell>{t(`feedback.targetType.${item.target_type}`)}</TableCell>
                <TableCell className="max-w-md truncate">
                  {/* Clicks bubble to the row; the button makes the row reachable by keyboard. */}
                  <button type="button" className="text-left hover:underline">
                    {item.message}
                  </button>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(item.created_at, i18n.language)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {pages.hasNextPage ? (
        <Button
          variant="outline"
          className="self-start"
          disabled={pages.isFetchingNextPage}
          onClick={() => pages.fetchNextPage()}
        >
          {t('common.loadMore')}
        </Button>
      ) : null}
      <Sheet open={open !== undefined} onOpenChange={(isOpen) => !isOpen && select(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {open ? (
            <>
              <SheetHeader>
                <SheetTitle>{t(`feedback.statuses.${open.status}`)}</SheetTitle>
                <SheetDescription>{t(`feedback.targetType.${open.target_type}`)}</SheetDescription>
              </SheetHeader>
              <FeedbackDetail item={open} />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
