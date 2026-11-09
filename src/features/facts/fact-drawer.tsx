import type { FactDto, FactId, FactStatus } from '@shared/facts'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateTime, formatPercent } from '@/shared/lib/format'
import { Button } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { EntryLink } from './entry-link'
import { FactStatusBadge, ReviewSignalBadge } from './fact-badges'
import { useFact, useRereviewFact, useRetractFact } from './hooks'
import { summarizeFact } from './summary'

// Mirrors the server's transition table so the drawer offers only moves the server accepts.
const actionsByStatus: Record<FactStatus, { retract: boolean; rereview: boolean }> = {
  pending: { retract: true, rereview: false },
  published: { retract: true, rereview: true },
  rejected: { retract: false, rereview: true },
  superseded: { retract: false, rereview: false },
  retracted: { retract: false, rereview: false },
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function FactDetail({ fact, onSelect }: { fact: FactDto; onSelect: (id: FactId) => void }) {
  const { t, i18n } = useTranslation()
  const retract = useRetractFact()
  const rereview = useRereviewFact()
  const actions = actionsByStatus[fact.status]
  const date = (iso: string) => formatDateTime(iso, i18n.language)
  const { review } = fact
  return (
    <div className="flex flex-col gap-5 px-4 pb-6 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <FactStatusBadge status={fact.status} />
        <ReviewSignalBadge fact={fact} />
      </div>
      <dl className="flex flex-col gap-2">
        <Field label={t('fact.payload')}>
          <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(fact.payload, null, 2)}</pre>
        </Field>
        <Field label={t('fact.entry')}>
          <EntryLink nodeId={fact.subject_id} />
        </Field>
        <Field label={t('fact.subject')}>
          <code className="text-xs">{fact.subject_id}</code>
        </Field>
        <Field label={t('fact.author')}>{fact.author}</Field>
        <Field label={t('fact.created')}>{date(fact.created_at)}</Field>
        {fact.supersedes_id ? (
          <Field label={t('fact.supersedes')}>
            <Button variant="link" className="h-auto p-0" onClick={() => onSelect(fact.supersedes_id as FactId)}>
              {fact.supersedes_id}
            </Button>
          </Field>
        ) : null}
      </dl>
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">{t('fact.review')}</h3>
        {review ? (
          <dl className="flex flex-col gap-2">
            <Field label={t('fact.reviewer')}>
              {review.reviewer} · {review.model}
            </Field>
            <Field label={t('fact.verdict')}>{t(`verdict.${review.verdict}`)}</Field>
            <Field label={t('fact.confidence')}>{formatPercent(review.confidence, i18n.language)}</Field>
            <Field label={t('fact.reason')}>{review.reason}</Field>
            <Field label={t('fact.reviewedAt')}>{date(review.reviewed_at)}</Field>
          </dl>
        ) : (
          <p className="text-muted-foreground">{t('fact.notReviewed')}</p>
        )}
      </section>
      <div className="flex gap-2">
        <Button
          variant="destructive"
          disabled={!actions.retract || retract.isPending}
          onClick={() => retract.mutate(fact.id)}
        >
          {t('fact.retract')}
        </Button>
        <Button
          variant="outline"
          disabled={!actions.rereview || rereview.isPending}
          onClick={() => rereview.mutate(fact.id)}
        >
          {t('fact.rereview')}
        </Button>
      </div>
      <ErrorNotice error={retract.error ?? rereview.error} />
    </div>
  )
}

/** Shows one fact with its review and lifecycle actions. Selecting another fact (a superseded one) reuses it. */
export function FactDrawer({ factId, onSelect }: { factId: FactId | null; onSelect: (id: FactId | null) => void }) {
  const { t } = useTranslation()
  const fact = useFact(factId)
  return (
    <Sheet open={factId !== null} onOpenChange={(open) => !open && onSelect(null)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{fact.data ? t('fact.title', { kind: t(`factKind.${fact.data.kind}`) }) : factId}</SheetTitle>
          <SheetDescription>{fact.data ? summarizeFact(fact.data) : null}</SheetDescription>
        </SheetHeader>
        <ErrorNotice error={fact.error} className="mx-4" />
        {fact.data ? <FactDetail key={fact.data.id} fact={fact.data} onSelect={onSelect} /> : null}
      </SheetContent>
    </Sheet>
  )
}
