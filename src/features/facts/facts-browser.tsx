import { type FactDto, type FactId, factKindSchema, factStatusSchema } from '@shared/facts'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { formatDateTime } from '@/shared/lib/format'
import { useSearchParamState } from '@/shared/lib/search-params'
import { Button } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { SelectField } from '@/shared/ui/select-field'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { FactFilter } from './api'
import { FactStatusBadge, ReviewSignalBadge, signalRowClass } from './fact-badges'
import { FactDrawer } from './fact-drawer'
import { useFactPages } from './hooks'
import { useFactSelection } from './selection'
import { summarizeFact } from './summary'

// Filters come from the URL, which is user input: anything outside the vocabulary is ignored.
function useFilter(): [FactFilter, (name: keyof FactFilter, value: string) => void] {
  const [params, setParam] = useSearchParamState()
  const filter = {
    status: factStatusSchema.safeParse(params.get('status')).data,
    kind: factKindSchema.safeParse(params.get('kind')).data,
  }
  return [filter, setParam]
}

/** A clickable fact row; flagged reviews are tinted so published-with-flaws data stands out. */
export function FactRow({ fact, onSelect }: { fact: FactDto; onSelect: (id: FactId) => void }) {
  const { t, i18n } = useTranslation()
  return (
    <TableRow className={cn('cursor-pointer', signalRowClass(fact))} onClick={() => onSelect(fact.id)}>
      <TableCell>
        <FactStatusBadge status={fact.status} />
      </TableCell>
      <TableCell>{t(`factKind.${fact.kind}`)}</TableCell>
      <TableCell className="max-w-md truncate">
        {/* Clicks bubble to the row; the button makes the row reachable by keyboard. */}
        <button type="button" className="text-left hover:underline">
          {summarizeFact(fact) || fact.subject_id}
        </button>
      </TableCell>
      <TableCell>
        <ReviewSignalBadge fact={fact} />
      </TableCell>
      <TableCell className="text-muted-foreground">{fact.author}</TableCell>
      <TableCell className="text-muted-foreground">{formatDateTime(fact.updated_at, i18n.language)}</TableCell>
    </TableRow>
  )
}

export function FactTable({ facts, onSelect }: { facts: FactDto[]; onSelect: (id: FactId) => void }) {
  const { t } = useTranslation()
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('facts.status')}</TableHead>
          <TableHead>{t('facts.kind')}</TableHead>
          <TableHead>{t('facts.claim')}</TableHead>
          <TableHead>{t('facts.review')}</TableHead>
          <TableHead>{t('facts.author')}</TableHead>
          <TableHead>{t('facts.updated')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {facts.map((fact) => (
          <FactRow key={fact.id} fact={fact} onSelect={onSelect} />
        ))}
      </TableBody>
    </Table>
  )
}

export function FactsBrowser() {
  const { t } = useTranslation()
  const [filter, setFilter] = useFilter()
  const [selected, select] = useFactSelection()
  const pages = useFactPages(filter)
  const facts = pages.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          label={t('facts.status')}
          value={filter.status ?? ''}
          onChange={(event) => setFilter('status', event.target.value)}
        >
          <option value="">{t('common.all')}</option>
          {factStatusSchema.options.map((status) => (
            <option key={status} value={status}>
              {t(`factStatus.${status}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('facts.kind')}
          value={filter.kind ?? ''}
          onChange={(event) => setFilter('kind', event.target.value)}
        >
          <option value="">{t('common.all')}</option>
          {factKindSchema.options.map((kind) => (
            <option key={kind} value={kind}>
              {t(`factKind.${kind}`)}
            </option>
          ))}
        </SelectField>
        <p className="ml-auto text-muted-foreground text-xs">{t('facts.flaggedHint')}</p>
      </div>
      <ErrorNotice error={pages.error} />
      {pages.isSuccess && facts.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('facts.empty')}</p>
      ) : null}
      {facts.length > 0 ? <FactTable facts={facts} onSelect={select} /> : null}
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
      <FactDrawer factId={selected} onSelect={select} />
    </div>
  )
}
