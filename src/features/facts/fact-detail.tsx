import type { FactDto, FactId, ListedFactDto } from '@shared/facts'
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { usePrincipalName } from '@/features/keys'
import { cn } from '@/shared/lib/cn'
import { formatPercent, formatStamp } from '@/shared/lib/format'
import { buttonVariants } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { groupEntry } from './entry-view'
import { FactFlagBadge, FactStatusBadge } from './fact-badges'
import { FactClaim } from './fact-claim'
import { factState } from './fact-state'
import { correctionChain } from './history'
import { useFact, useManagedEntry } from './hooks'
import { summarizeFact } from './summary'

/** Where in its entry a fact sits: the sense it is about, numbered as the entry orders its senses. */
function useFactContext(fact: ListedFactDto) {
  const entry = useManagedEntry(fact.entry.lemma)
  const senses = entry.data ? groupEntry(entry.data).senses : []
  const index = senses.findIndex((view) => view.sense.id === fact.subject_id)
  return {
    error: entry.error,
    sense: index >= 0 ? { number: index + 1, ...senses[index] } : null,
    facts: entry.data?.facts ?? [],
  }
}

function Review({ fact }: { fact: FactDto }) {
  const { t, i18n } = useTranslation()
  const { review } = fact
  if (!review)
    return <p className="rounded-xl border p-4 text-muted-foreground text-sm">{t('factDetail.notReviewed')}</p>
  const state = factState(fact)
  const tone =
    state === 'flagged'
      ? 'border-warning/60 bg-warning/10'
      : state === 'failed' || review.verdict === 'fail'
        ? 'border-destructive/40 bg-destructive/5'
        : ''
  const bar =
    review.verdict === 'pass' ? 'bg-primary' : review.verdict === 'uncertain' ? 'bg-warning' : 'bg-destructive'
  return (
    <section aria-label={t('factDetail.review')} className={cn('flex flex-col gap-3 rounded-xl border p-4', tone)}>
      <div className="flex items-center gap-3">
        <h3 className="font-semibold text-lg">{t(`verdict.${review.verdict}`)}</h3>
        <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <span className={cn('block h-full rounded-full', bar)} style={{ width: `${review.confidence * 100}%` }} />
        </span>
        <span className="font-medium text-sm tabular-nums">
          {t('factDetail.confidence', { confidence: formatPercent(review.confidence, i18n.language) })}
        </span>
      </div>
      <p className="text-sm leading-relaxed">{review.reason}</p>
      <p className="text-muted-foreground text-xs">
        {review.reviewer} · {review.model} · {formatStamp(review.reviewed_at, i18n.language)}
      </p>
    </section>
  )
}

function History({ chain, current, onSelect }: { chain: FactDto[]; current: FactId; onSelect: (id: FactId) => void }) {
  const { t, i18n } = useTranslation()
  const nameOf = usePrincipalName()
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">{t('factDetail.history')}</h3>
      <ul className="flex flex-col gap-1">
        {chain.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              disabled={item.id === current}
              onClick={() => onSelect(item.id)}
              className="flex w-full items-center gap-3 rounded-md px-1 py-1.5 text-left text-sm enabled:hover:bg-muted disabled:cursor-default"
            >
              <FactStatusBadge status={item.status} />
              <span className="min-w-0 flex-1 truncate font-serif">{summarizeFact(item)}</span>
              <span className="shrink-0 text-muted-foreground text-xs">
                {nameOf(item.author)} · {formatStamp(item.created_at, i18n.language)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Detail({ fact, onSelect }: { fact: ListedFactDto; onSelect: (id: FactId) => void }) {
  const { t } = useTranslation()
  const context = useFactContext(fact)
  const chain = correctionChain(fact, context.facts)
  const kindLine = [
    t(`factKind.${fact.kind}`),
    context.sense ? t('factDetail.senseNumber', { number: context.sense.number }) : null,
    context.sense ? t(`pos.${context.sense.sense.pos}`) : null,
  ].filter(Boolean)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <p className="pt-1 text-muted-foreground text-xs">{kindLine.join(' · ')}</p>
        <Link
          to={`/console/entries/${encodeURIComponent(fact.entry.lemma)}`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <ArrowUpRight aria-hidden />
          {t('factDetail.openEntry')}
        </Link>
      </div>
      <ErrorNotice error={context.error} />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold font-serif text-3xl">{fact.entry.lemma}</h2>
        <FactStatusBadge status={fact.status} />
        <FactFlagBadge fact={fact} long />
      </div>
      <div className="flex flex-col gap-2 rounded-xl bg-muted p-4">
        {context.sense?.item ? (
          <p className="text-muted-foreground text-xs">
            {t('factDetail.senseNumber', { number: context.sense.number })} · {context.sense.item.gloss}
          </p>
        ) : null}
        <FactClaim fact={fact} size="lg" />
        <details className="group text-xs">
          <summary className="flex cursor-pointer items-center gap-1 text-muted-foreground">
            <ChevronRight aria-hidden className="size-3.5 transition-transform group-open:rotate-90" />
            {t('factDetail.technical')}
          </summary>
          <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">{t('factDetail.factId')}</dt>
            <dd className="break-all font-mono">{fact.id}</dd>
            <dt className="text-muted-foreground">{t('factDetail.subjectId')}</dt>
            <dd className="break-all font-mono">{fact.subject_id}</dd>
            <dt className="text-muted-foreground">{t('factDetail.payload')}</dt>
            <dd>
              <pre className="overflow-x-auto rounded-md bg-background p-2">
                {JSON.stringify(fact.payload, null, 2)}
              </pre>
            </dd>
          </dl>
        </details>
      </div>
      <Review fact={fact} />
      {chain.length > 1 ? <History chain={chain} current={fact.id} onSelect={onSelect} /> : null}
    </div>
  )
}

/** One fact read-only: its claim, its review, the task fixing it, and its corrections. */
export function FactDetail({ factId, onSelect }: { factId: FactId; onSelect: (id: FactId) => void }) {
  const fact = useFact(factId)
  if (fact.error) return <ErrorNotice error={fact.error} />
  if (!fact.data) return null
  return <Detail key={fact.data.id} fact={fact.data} onSelect={onSelect} />
}
