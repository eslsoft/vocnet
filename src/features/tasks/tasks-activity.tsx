import { type WorkAttemptDto, workAttemptOutcomeSchema } from '@shared/monitor'
import { type WorkItemId, workItemIdSchema, workTypeSchema } from '@shared/work'
import { useTranslation } from 'react-i18next'
import { useAgentOptions, usePrincipalName } from '@/features/keys'
import { formatDuration, formatRelative } from '@/shared/lib/format'
import { useDebouncedParam, useSearchParamState } from '@/shared/lib/search-params'
import { Button } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { FilterSelect } from '@/shared/ui/filter-select'
import { Input } from '@/shared/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { AttemptFilter } from './api'
import { useAttemptPages } from './hooks'
import { OutcomeBadge, TaskTypeBadge } from './task-badges'
import { TaskSheet } from './task-sheet'

// Filters come from the URL, which is user input: anything outside the vocabulary is ignored.
function useActivityParams() {
  const [params, setParam] = useSearchParamState()
  const [lemma, draft, setDraft] = useDebouncedParam('entry')
  const filter: AttemptFilter = {
    lemma: lemma || undefined,
    outcome: workAttemptOutcomeSchema.safeParse(params.get('result')).data,
    type: workTypeSchema.safeParse(params.get('type')).data,
    holder: params.get('agent') ?? undefined,
  }
  return {
    filter,
    draft,
    setDraft,
    setParam,
    selected: workItemIdSchema.safeParse(params.get('task')).data ?? null,
    select: (id: WorkItemId | null) => setParam('task', id),
  }
}

function AttemptRow({ attempt, onSelect }: { attempt: WorkAttemptDto; onSelect: (id: WorkItemId) => void }) {
  const { t, i18n } = useTranslation()
  const nameOf = usePrincipalName()
  return (
    <TableRow className="cursor-pointer" onClick={() => onSelect(attempt.item_id)}>
      <TableCell className="text-muted-foreground">{formatRelative(attempt.completed_at, i18n.language)}</TableCell>
      <TableCell className="font-mono">{nameOf(attempt.holder)}</TableCell>
      <TableCell className="tabular-nums">{t('activity.tryNumber', { number: attempt.attempt })}</TableCell>
      <TableCell className="max-w-72 truncate">
        {/* Clicks bubble to the row; the button makes the row reachable by keyboard. */}
        <button type="button" className="text-left hover:underline">
          <span className="font-semibold font-serif text-base">{attempt.entry.lemma}</span>
          <span className="ml-2 text-muted-foreground text-xs">{attempt.sense_gloss ?? t('activity.wholeEntry')}</span>
        </button>
      </TableCell>
      <TableCell>
        <TaskTypeBadge type={attempt.type} />
      </TableCell>
      <TableCell>
        <OutcomeBadge outcome={attempt.outcome} />
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">{formatDuration(attempt.seconds)}</TableCell>
      <TableCell className="text-right tabular-nums">{attempt.facts.length}</TableCell>
    </TableRow>
  )
}

/** Every completed attempt, newest first, with the task it worked on a click away. */
export function TasksActivity() {
  const { t } = useTranslation()
  const { filter, draft, setDraft, setParam, selected, select } = useActivityParams()
  const agents = useAgentOptions()
  const pages = useAttemptPages(filter)
  const attempts = pages.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label={t('activity.entry')}
          placeholder={t('activity.entryHint')}
          maxLength={100}
          value={draft}
          className="w-56"
          onChange={(event) => setDraft(event.target.value)}
        />
        <FilterSelect
          label={t('activity.result')}
          allLabel={t('common.all')}
          value={filter.outcome ?? null}
          options={workAttemptOutcomeSchema.options.map((value) => ({ value, label: t(`outcome.${value}`) }))}
          onChange={(value) => setParam('result', value)}
        />
        <FilterSelect
          label={t('activity.task')}
          allLabel={t('common.all')}
          value={filter.type ?? null}
          options={workTypeSchema.options.map((value) => ({ value, label: t(`taskType.${value}`) }))}
          onChange={(value) => setParam('type', value)}
        />
        <FilterSelect
          label={t('activity.agent')}
          allLabel={t('common.all')}
          value={filter.holder ?? null}
          options={agents}
          onChange={(value) => setParam('agent', value)}
        />
      </div>
      <ErrorNotice error={pages.error} />
      {pages.isSuccess && attempts.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('activity.empty')}</p>
      ) : null}
      {attempts.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('activity.finished')}</TableHead>
              <TableHead>{t('activity.agent')}</TableHead>
              <TableHead>{t('activity.try')}</TableHead>
              <TableHead>{t('activity.entry')}</TableHead>
              <TableHead>{t('activity.task')}</TableHead>
              <TableHead>{t('activity.result')}</TableHead>
              <TableHead className="text-right">{t('activity.timeSpent')}</TableHead>
              <TableHead className="text-right">{t('activity.facts')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attempts.map((attempt) => (
              <AttemptRow key={attempt.id} attempt={attempt} onSelect={select} />
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
      <TaskSheet taskId={selected} onClose={() => select(null)} />
    </div>
  )
}
