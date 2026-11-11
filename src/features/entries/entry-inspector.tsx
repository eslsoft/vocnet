import type { managedEntryDetailSchema } from '@shared/catalog'
import type { WorkItemOverview } from '@shared/monitor'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { z } from 'zod'
import { EntryView } from '@/features/dictionary'
import { FactSheet, FactStatusBadge, groupEntry, useFactSelection, useManagedEntry } from '@/features/facts'
import { usePrincipalName } from '@/features/keys'
import { gapText, TaskStatusBadge, TaskTypeBadge, taskPath, useTasks } from '@/features/tasks'
import { formatNumber, formatPercent, formatRelative } from '@/shared/lib/format'
import { useSearchParamState } from '@/shared/lib/search-params'
import { Badge } from '@/shared/ui/badge'
import { buttonVariants } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Progress } from '@/shared/ui/progress'
import { SegmentedBar } from '@/shared/ui/segmented-bar'
import { StatCard } from '@/shared/ui/stat-card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { ReferenceData, SensesOutline, WordDetails } from './entry-side'
import { FactsAndGaps } from './facts-and-gaps'
import { factHealth, lastChange, taskCounts } from './scores'

type ManagedEntryDetail = z.infer<typeof managedEntryDetailSchema>

const VIEWS = ['preview', 'facts', 'tasks'] as const
type View = (typeof VIEWS)[number]

function Header({ entry }: { entry: ManagedEntryDetail }) {
  const { t, i18n } = useTranslation()
  const nameOf = usePrincipalName()
  const entryFact = entry.facts.find((fact) => fact.kind === 'entry' && fact.subject_id === entry.entry.id)
  const ipa = entry.facts.find(
    (fact) => fact.kind === 'pronunciation' && fact.status === 'published' && fact.subject_id === entry.entry.id,
  )
  const latest = lastChange(entry)
  const lemma = entry.entry.lemma
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label={t('inspector.breadcrumb')} className="flex items-center gap-1 text-muted-foreground text-sm">
        <Link to="/console/entries" className="hover:text-foreground hover:underline">
          {t('nav.entries')}
        </Link>
        <ChevronRight aria-hidden className="size-4" />
        <span aria-current="page" className="text-foreground">
          {lemma}
        </span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-baseline gap-3">
            <span className="font-semibold font-serif text-5xl tracking-tight">{lemma}</span>
            {ipa?.kind === 'pronunciation' ? (
              <span className="font-serif text-muted-foreground text-xl">/{ipa.payload.ipa}/</span>
            ) : null}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
            {entryFact ? <FactStatusBadge status={entryFact.status} /> : null}
            {entry.cefr.length > 0 ? (
              <Badge variant="outline">
                {entry.cefr.map((item) => `${item.level} ${t(`pos.${item.pos}`)}`).join(' · ')}
              </Badge>
            ) : null}
            {entry.frequency ? (
              <Badge variant="outline">
                {t('inspector.frequencyRank', { rank: formatNumber(entry.frequency.rank, i18n.language) })}
              </Badge>
            ) : null}
            <span>
              {t('inspector.senseCount', { count: entry.senses.length })}
              {latest
                ? ` · ${t('inspector.updated', {
                    when: formatRelative(latest.updated_at, i18n.language),
                    who: nameOf(latest.author),
                  })}`
                : null}
            </span>
          </div>
        </div>
        <a href={`/words/${encodeURIComponent(lemma)}`} className={buttonVariants({ variant: 'outline' })}>
          <ExternalLink aria-hidden />
          {t('inspector.publicPage')}
        </a>
      </div>
    </div>
  )
}

function Scores({ entry, tasks }: { entry: ManagedEntryDetail; tasks: WorkItemOverview[] }) {
  const { t, i18n } = useTranslation()
  const percent = (value: number, digits = 0) => formatPercent(value, i18n.language, digits)
  const { slots } = entry
  const health = factHealth(entry)
  const counts = taskCounts(tasks)
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <StatCard label={t('entries.completeness')} value={percent(entry.completeness)}>
        <SegmentedBar
          total={slots.total}
          label={t('entries.slotsLabel', { published: slots.published, pending: slots.pending, total: slots.total })}
          segments={[
            { value: slots.published, className: 'bg-primary' },
            { value: slots.pending, className: 'bg-info' },
          ]}
        />
        <span>
          {t('inspector.filled', {
            filled: slots.published + slots.pending,
            total: slots.total,
            pending: slots.pending,
          })}
        </span>
      </StatCard>
      <StatCard label={t('entries.quality')} value={percent(entry.quality, 1)}>
        <Progress value={entry.quality * 100} aria-label={t('entries.quality')} />
        <span>{t('overview.flaggedOf', { flagged: health.flagged, live: health.live })}</span>
      </StatCard>
      <StatCard label={t('entries.openTasks')} value={tasks.length}>
        <SegmentedBar
          total={tasks.length}
          label={t('inspector.taskCounts', counts)}
          segments={[
            { value: counts.queued, className: 'bg-muted-foreground/40' },
            { value: counts.in_progress, className: 'bg-primary' },
            { value: counts.waiting_on_review, className: 'bg-info' },
            { value: counts.stuck, className: 'bg-destructive' },
          ]}
        />
        <span>{t('inspector.taskCounts', counts)}</span>
      </StatCard>
    </div>
  )
}

function EntryTasks({ tasks }: { tasks: WorkItemOverview[] }) {
  const { t } = useTranslation()
  if (tasks.length === 0) return <p className="text-muted-foreground text-sm">{t('inspector.noTasks')}</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('tasks.task')}</TableHead>
          <TableHead>{t('inspector.about')}</TableHead>
          <TableHead>{t('taskDetail.missing')}</TableHead>
          <TableHead>{t('inspector.status')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TableRow key={task.id}>
            <TableCell>
              <Link to={taskPath(task.id)} className="hover:underline">
                <TaskTypeBadge type={task.type} />
              </Link>
            </TableCell>
            <TableCell className="max-w-56 truncate font-serif">
              {task.sense_gloss ?? t('activity.wholeEntry')}
            </TableCell>
            <TableCell className="max-w-80 truncate">{gapText(task.gap, t)}</TableCell>
            <TableCell>
              <TaskStatusBadge status={task.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function useView(): [View, (view: View) => void] {
  const [params, setParam] = useSearchParamState()
  const view = VIEWS.find((candidate) => candidate === params.get('view')) ?? 'facts'
  return [view, (next) => setParam('view', next === 'facts' ? null : next)]
}

function Inspector({ entry }: { entry: ManagedEntryDetail }) {
  const { t } = useTranslation()
  const tasks = useTasks({ entry_id: entry.entry.id })
  const [, select] = useFactSelection()
  const [view, setView] = useView()
  const open = tasks.data?.items ?? []
  const { entryFacts, senses } = groupEntry(entry)
  const entryTasks = open.filter((task) => task.subject_id === entry.entry.id)
  return (
    <div className="flex flex-col gap-6">
      <Header entry={entry} />
      <ErrorNotice error={tasks.error} />
      <Scores entry={entry} tasks={open} />
      <Tabs value={view} onValueChange={(value) => setView(value as View)}>
        <TabsList className="h-9">
          <TabsTrigger value="preview" className="px-3">
            {t('inspector.preview')}
          </TabsTrigger>
          <TabsTrigger value="facts" className="px-3">
            {t('inspector.factsAndGaps')}
          </TabsTrigger>
          <TabsTrigger value="tasks" className="px-3">
            {t('inspector.tasksTab', { count: open.length })}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="preview" className="pt-4">
          <EntryView lemma={entry.entry.lemma} domain={undefined} />
        </TabsContent>
        <TabsContent value="facts" className="pt-4">
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <FactsAndGaps senses={senses} tasks={open} onSelect={select} />
            <div className="flex flex-col gap-4">
              <SensesOutline senses={senses} />
              <WordDetails facts={entryFacts} tasks={entryTasks} onSelect={select} />
              <ReferenceData frequency={entry.frequency} cefr={entry.cefr} />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="tasks" className="pt-4">
          <EntryTasks tasks={open} />
        </TabsContent>
      </Tabs>
      <FactSheet />
    </div>
  )
}

/** One entry as admins inspect it: how complete and reliable it is, every fact in context, and its open tasks. */
export function EntryInspector({ lemma }: { lemma: string }) {
  const { t } = useTranslation()
  const entry = useManagedEntry(lemma)
  if (entry.error)
    return (
      <div className="flex flex-col gap-3">
        <Link to="/console/entries" className="text-muted-foreground text-sm hover:underline">
          {t('nav.entries')}
        </Link>
        <ErrorNotice error={entry.error} />
      </div>
    )
  if (!entry.data) return null
  return <Inspector entry={entry.data} />
}
