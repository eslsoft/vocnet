import type { EntrySummary } from '@shared/catalog'
import { cefrLevelSchema } from '@shared/reference'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { cn } from '@/shared/lib/cn'
import { formatPercent, formatRelative } from '@/shared/lib/format'
import { useDebouncedParam, useSearchParamState } from '@/shared/lib/search-params'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { FilterSelect } from '@/shared/ui/filter-select'
import { Input } from '@/shared/ui/input'
import { SegmentedBar } from '@/shared/ui/segmented-bar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { Toggle } from '@/shared/ui/toggle'
import type { EntryFilter } from './api'
import { useEntryPages } from './hooks'
import { QUALITY_WATCH } from './scores'

export const entryPath = (lemma: string) => `/console/entries/${encodeURIComponent(lemma)}`

// Filters come from the URL, which is user input: anything outside the vocabulary is ignored.
function useFilter() {
  const [params, setParam] = useSearchParamState()
  const [prefix, draft, setDraft] = useDebouncedParam('prefix')
  const filter: EntryFilter = {
    prefix: prefix || undefined,
    level: cefrLevelSchema.safeParse(params.get('level')).data,
    flagged: params.get('flagged') === 'true' ? 'true' : undefined,
    stuck: params.get('stuck') === 'true' ? 'true' : undefined,
  }
  return { filter, draft, setDraft, setParam }
}

function Completeness({ entry }: { entry: EntrySummary }) {
  const { t, i18n } = useTranslation()
  const { slots } = entry
  const filled = slots.published + slots.pending
  return (
    <div className="flex items-center gap-2">
      <SegmentedBar
        className="w-32"
        total={slots.total}
        label={t('entries.slotsLabel', { published: slots.published, pending: slots.pending, total: slots.total })}
        segments={[
          { value: slots.published, className: 'bg-primary' },
          { value: slots.pending, className: 'bg-info' },
        ]}
      />
      <span className="w-11 text-right font-medium tabular-nums">
        {formatPercent(entry.completeness, i18n.language)}
      </span>
      <span className="text-muted-foreground text-xs tabular-nums">
        {filled}/{slots.total}
      </span>
    </div>
  )
}

function OpenTasks({ entry }: { entry: EntrySummary }) {
  const { t } = useTranslation()
  const work = entry.open_work
  if (work.total === 0) return <span className="font-medium text-success-foreground">{t('entries.noTasks')}</span>
  if (work.stuck > 0)
    return (
      <span className="font-medium text-destructive">
        {work.total} · {t('entries.stuckCount', { count: work.stuck })}
      </span>
    )
  const detail =
    work.in_progress > 0
      ? t('entries.inProgressCount', { count: work.in_progress })
      : work.waiting_on_review > 0
        ? t('entries.inReviewCount', { count: work.waiting_on_review })
        : null
  return (
    <span className="tabular-nums">
      {work.total}
      {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
    </span>
  )
}

function EntryRow({ entry }: { entry: EntrySummary }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const live = (entry.fact_counts.published ?? 0) + (entry.fact_counts.pending ?? 0)
  return (
    <TableRow className="cursor-pointer" onClick={() => navigate(entryPath(entry.lemma))}>
      <TableCell>
        <Link className="font-semibold font-serif text-base hover:underline" to={entryPath(entry.lemma)}>
          {entry.lemma}
        </Link>
      </TableCell>
      <TableCell>{entry.level ? <Badge variant="outline">{entry.level}</Badge> : '—'}</TableCell>
      <TableCell className="text-right tabular-nums">{entry.sense_count}</TableCell>
      <TableCell>
        <Completeness entry={entry} />
      </TableCell>
      <TableCell
        className={cn(
          'tabular-nums',
          entry.quality < QUALITY_WATCH && live > 0 && 'font-medium text-warning-foreground',
        )}
      >
        {live === 0 ? '—' : formatPercent(entry.quality, i18n.language, 1)}
      </TableCell>
      <TableCell>
        <OpenTasks entry={entry} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {entry.last_worked_at ? formatRelative(entry.last_worked_at, i18n.language) : t('entries.never')}
      </TableCell>
    </TableRow>
  )
}

function Legend() {
  const { t } = useTranslation()
  const items = [
    { className: 'bg-primary', label: t('entries.legend.published') },
    { className: 'bg-info', label: t('entries.legend.pending') },
    { className: 'bg-muted', label: t('entries.legend.missing') },
  ]
  return (
    <ul className="flex flex-wrap gap-4 text-muted-foreground text-xs">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className={cn('size-2 rounded-sm', item.className)} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/** Every entry with how complete and reliable it is and its open tasks, narrowed by prefix, level, and trouble. */
export function EntryList() {
  const { t } = useTranslation()
  const { filter, draft, setDraft, setParam } = useFilter()
  const pages = useEntryPages(filter)
  const entries = pages.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label={t('entries.prefix')}
          placeholder={t('entries.prefixHint')}
          maxLength={100}
          value={draft}
          className="w-56"
          onChange={(event) => setDraft(event.target.value)}
        />
        <FilterSelect
          label={t('entries.level')}
          allLabel={t('common.all')}
          value={filter.level ?? null}
          options={cefrLevelSchema.options.map((level) => ({ value: level, label: level }))}
          onChange={(value) => setParam('level', value)}
        />
        <Toggle
          variant="outline"
          pressed={filter.flagged === 'true'}
          onPressedChange={(pressed) => setParam('flagged', pressed ? 'true' : null)}
        >
          {t('entries.hasFlagged')}
        </Toggle>
        <Toggle
          variant="outline"
          pressed={filter.stuck === 'true'}
          onPressedChange={(pressed) => setParam('stuck', pressed ? 'true' : null)}
        >
          {t('entries.hasStuck')}
        </Toggle>
      </div>
      <ErrorNotice error={pages.error} />
      {pages.isSuccess && entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('entries.empty')}</p>
      ) : null}
      {entries.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('entries.entry')}</TableHead>
              <TableHead>{t('entries.level')}</TableHead>
              <TableHead className="text-right">{t('entries.senses')}</TableHead>
              <TableHead>{t('entries.completeness')}</TableHead>
              <TableHead>{t('entries.quality')}</TableHead>
              <TableHead>{t('entries.openTasks')}</TableHead>
              <TableHead>{t('entries.lastUpdated')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </TableBody>
        </Table>
      ) : null}
      {entries.length > 0 ? <Legend /> : null}
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
    </div>
  )
}
