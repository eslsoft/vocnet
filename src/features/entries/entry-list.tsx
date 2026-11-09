import type { EntrySummary } from '@shared/catalog'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { FactStatusBadge } from '@/features/facts'
import { formatDateTime } from '@/shared/lib/format'
import { useSearchParamState } from '@/shared/lib/search-params'
import { Button } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Input } from '@/shared/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { useEntryPages } from './hooks'

const PREFIX_DEBOUNCE_MS = 300

const entryPath = (lemma: string) => `/entries/${encodeURIComponent(lemma)}`

/** The prefix lives in the URL; typing updates it once the admin pauses. */
function usePrefix(): [string, string, (value: string) => void] {
  const [params, setParam] = useSearchParamState()
  const prefix = params.get('prefix') ?? ''
  const [draft, setDraft] = useState(prefix)
  const [seen, setSeen] = useState(prefix)
  // Back and forward change the URL under the input; follow them unless the input already says it.
  if (prefix !== seen) {
    setSeen(prefix)
    if (prefix !== draft.trim()) setDraft(prefix)
  }
  useEffect(() => {
    const next = draft.trim()
    if (next === prefix) return
    const timer = setTimeout(() => setParam('prefix', next || null), PREFIX_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, prefix, setParam])
  return [prefix, draft, setDraft]
}

function EntryRow({ entry }: { entry: EntrySummary }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { fact_counts: counts } = entry
  return (
    <TableRow className="cursor-pointer" onClick={() => navigate(entryPath(entry.lemma))}>
      <TableCell className="font-medium">
        <Link className="hover:underline" to={entryPath(entry.lemma)}>
          {entry.lemma}
        </Link>
      </TableCell>
      <TableCell>
        {entry.entry_status ? (
          <FactStatusBadge status={entry.entry_status} />
        ) : (
          <span className="text-muted-foreground">{t('entries.noEntryFact')}</span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">{entry.sense_count}</TableCell>
      <TableCell className="text-right tabular-nums">{counts.published}</TableCell>
      <TableCell className="text-right tabular-nums">{counts.pending}</TableCell>
      <TableCell className="text-right tabular-nums">{counts.rejected}</TableCell>
      <TableCell className="text-muted-foreground">
        {entry.last_worked_at ? formatDateTime(entry.last_worked_at, i18n.language) : t('entries.neverWorked')}
      </TableCell>
    </TableRow>
  )
}

/** Every entry in lemma order with its progress, so the admin can watch agents fill the dictionary. */
export function EntryList() {
  const { t } = useTranslation()
  const [prefix, draft, setDraft] = usePrefix()
  const pages = useEntryPages(prefix)
  const entries = pages.data?.pages.flatMap((page) => page.items) ?? []
  const inputId = useId()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex max-w-xs flex-col gap-1">
        <label htmlFor={inputId} className="text-muted-foreground text-xs">
          {t('entries.prefix')}
        </label>
        <Input
          id={inputId}
          type="search"
          maxLength={100}
          value={draft}
          placeholder={t('entries.prefixHint')}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <ErrorNotice error={pages.error} />
      {pages.isSuccess && entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('entries.empty')}</p>
      ) : null}
      {entries.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('entries.lemma')}</TableHead>
              <TableHead>{t('entries.status')}</TableHead>
              <TableHead className="text-right">{t('entries.senses')}</TableHead>
              <TableHead className="text-right">{t('factStatus.published')}</TableHead>
              <TableHead className="text-right">{t('factStatus.pending')}</TableHead>
              <TableHead className="text-right">{t('factStatus.rejected')}</TableHead>
              <TableHead>{t('entries.lastWorked')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
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
    </div>
  )
}
