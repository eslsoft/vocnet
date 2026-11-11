import { type FactId, factKindSchema, factStatusSchema, type ListedFactDto } from '@shared/facts'
import { cefrLevelSchema } from '@shared/reference'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAgentOptions } from '@/features/keys'
import { cn } from '@/shared/lib/cn'
import { formatNumber, formatRelative } from '@/shared/lib/format'
import { useDebouncedParam, useSearchParamState } from '@/shared/lib/search-params'
import { Button } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { FilterSelect } from '@/shared/ui/filter-select'
import { Input } from '@/shared/ui/input'
import { Toggle } from '@/shared/ui/toggle'
import type { FactFilter } from './api'
import { FactStateBadge } from './fact-badges'
import { FactClaim } from './fact-claim'
import { FactDetail } from './fact-detail'
import { factState } from './fact-state'
import { useFactPages } from './hooks'
import { useFactSelection } from './selection'

// Filters come from the URL, which is user input: anything outside the vocabulary is ignored.
function useFilter() {
  const [params, setParam] = useSearchParamState()
  const [lemma, draft, setDraft] = useDebouncedParam('entry')
  const filter: FactFilter = {
    status: factStatusSchema.safeParse(params.get('status')).data,
    kind: factKindSchema.safeParse(params.get('kind')).data,
    weak: params.get('flagged') === 'true' ? 'true' : undefined,
    level: cefrLevelSchema.safeParse(params.get('level')).data,
    author: params.get('author') ?? undefined,
    lemma: lemma || undefined,
  }
  return { filter, draft, setDraft, setParam }
}

function FactRow({
  fact,
  selected,
  onSelect,
}: {
  fact: ListedFactDto
  selected: boolean
  onSelect: (id: FactId) => void
}) {
  const { t, i18n } = useTranslation()
  const state = factState(fact)
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(fact.id)}
        className={cn(
          'flex w-full flex-col gap-1 border-b border-l-2 border-l-transparent px-4 py-3 text-left hover:bg-muted/60',
          selected && 'border-l-primary bg-accent hover:bg-accent',
        )}
      >
        <span className="flex items-center gap-2">
          <span className="font-semibold font-serif text-base">{fact.entry.lemma}</span>
          <span className="text-muted-foreground text-xs">{t(`factKind.${fact.kind}`)}</span>
          <span className="ml-auto">
            <FactStateBadge fact={fact} />
          </span>
        </span>
        <span className="flex items-center gap-2 text-sm">
          <span className={cn('min-w-0 flex-1 truncate', state === 'rejected' && 'text-muted-foreground line-through')}>
            <FactClaim fact={fact} />
          </span>
          <span className="shrink-0 text-muted-foreground text-xs">
            {formatRelative(fact.updated_at, i18n.language)}
          </span>
        </span>
      </button>
    </li>
  )
}

function Filters({ flagged }: { flagged: number | undefined }) {
  const { t, i18n } = useTranslation()
  const { filter, draft, setDraft, setParam } = useFilter()
  const authors = useAgentOptions()
  return (
    <div className="flex flex-col gap-3 border-b px-4 pb-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="font-semibold text-2xl tracking-tight">{t('facts.title')}</h1>
        <span className="text-muted-foreground text-xs">
          {flagged === undefined
            ? t('facts.newestFirst')
            : t('facts.flaggedNewest', { flagged: formatNumber(flagged, i18n.language) })}
        </span>
      </div>
      <Input
        type="search"
        aria-label={t('facts.entry')}
        placeholder={t('facts.entryHint')}
        maxLength={100}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Toggle
          variant="outline"
          pressed={filter.weak === 'true'}
          onPressedChange={(pressed) => setParam('flagged', pressed ? 'true' : null)}
          className="aria-pressed:border-warning/60 aria-pressed:bg-warning/10 aria-pressed:text-warning-foreground"
        >
          <AlertTriangle aria-hidden />
          {t('facts.flaggedOnly')}
        </Toggle>
        <FilterSelect
          label={t('facts.type')}
          allLabel={t('common.all')}
          value={filter.kind ?? null}
          options={factKindSchema.options.map((kind) => ({ value: kind, label: t(`factKind.${kind}`) }))}
          onChange={(value) => setParam('kind', value)}
        />
        <FilterSelect
          label={t('facts.status')}
          allLabel={t('common.all')}
          value={filter.status ?? null}
          options={factStatusSchema.options.map((status) => ({ value: status, label: t(`factStatus.${status}`) }))}
          onChange={(value) => setParam('status', value)}
        />
        <FilterSelect
          label={t('facts.level')}
          allLabel={t('common.all')}
          value={filter.level ?? null}
          options={cefrLevelSchema.options.map((level) => ({ value: level, label: level }))}
          onChange={(value) => setParam('level', value)}
        />
        <FilterSelect
          label={t('facts.author')}
          allLabel={t('common.all')}
          value={filter.author ?? null}
          options={authors}
          onChange={(value) => setParam('author', value)}
        />
      </div>
    </div>
  )
}

/** Facts newest first beside the one selected; flagged facts are what the admin watches most. */
export function FactsBrowser({ flagged }: { flagged?: number }) {
  const { t } = useTranslation()
  const { filter } = useFilter()
  const [selected, select] = useFactSelection()
  const pages = useFactPages(filter)
  const facts = pages.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <div className="grid overflow-hidden rounded-xl border bg-card lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col pt-4 lg:max-h-[calc(100dvh-4rem)] lg:border-r">
        <Filters flagged={flagged} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ErrorNotice error={pages.error} className="m-4" />
          {pages.isSuccess && facts.length === 0 ? (
            <p className="p-4 text-muted-foreground text-sm">{t('facts.empty')}</p>
          ) : null}
          <ul aria-label={t('facts.list')}>
            {facts.map((fact) => (
              <FactRow key={fact.id} fact={fact} selected={fact.id === selected} onSelect={select} />
            ))}
          </ul>
          {pages.hasNextPage ? (
            <div className="p-4">
              <Button variant="outline" disabled={pages.isFetchingNextPage} onClick={() => pages.fetchNextPage()}>
                {t('common.loadMore')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <section
        aria-label={t('facts.detail')}
        className="min-w-0 border-t p-6 lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:border-t-0"
      >
        {selected ? (
          <FactDetail factId={selected} onSelect={select} />
        ) : (
          <p className="text-muted-foreground text-sm">{t('facts.pick')}</p>
        )}
      </section>
    </div>
  )
}
