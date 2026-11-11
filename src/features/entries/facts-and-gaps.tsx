import type { FactDto, FactId, FactKind } from '@shared/facts'
import type { WorkItemOverview } from '@shared/monitor'
import type { WorkType } from '@shared/work'
import { ChevronDown } from 'lucide-react'
import { Fragment, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SenseView } from '@/features/facts'
import { Button } from '@/shared/ui/button'
import { FactRow, IncomingRow, TaskRow } from './fact-rows'

/** The blocks of a sense, each with the fact kinds it shows and the tasks that would add to it. */
const GROUPS: Array<{ key: string; kinds: FactKind[]; tasks: WorkType[]; incoming?: boolean }> = [
  { key: 'examples', kinds: ['example'], tasks: ['examples', 'example_translations'] },
  { key: 'translations', kinds: ['translation'], tasks: ['translations'] },
  { key: 'relations', kinds: ['relation'], tasks: ['category', 'parts', 'synonyms'], incoming: true },
  { key: 'collocations', kinds: ['collocation'], tasks: ['collocations'] },
  { key: 'topics', kinds: ['topic'], tasks: ['topics'] },
  { key: 'grammar', kinds: ['grammar'], tasks: ['grammar'] },
  { key: 'closures', kinds: ['gap_closure'], tasks: [] },
]

/** Senses shown before the rest fold away. */
const FIRST_SENSES = 3

/** Replaced and retracted facts are history; the fact detail shows them. */
const isCurrent = (fact: FactDto) => fact.status !== 'superseded' && fact.status !== 'retracted'

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_1fr] sm:gap-3">
      <span className="pt-1.5 text-muted-foreground text-xs">{label}</span>
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
    </div>
  )
}

function Facts({
  facts,
  weak,
  onSelect,
}: {
  facts: FactDto[]
  weak: ReadonlyMap<string, WorkItemOverview>
  onSelect: (id: FactId) => void
}) {
  return facts.map((fact) => {
    const task = weak.get(fact.id)
    return (
      <Fragment key={fact.id}>
        <FactRow fact={fact} onSelect={onSelect} />
        {task ? <TaskRow task={task} /> : null}
      </Fragment>
    )
  })
}

function SenseBlock({
  view,
  number,
  tasks,
  weak,
  onSelect,
}: {
  view: SenseView
  number: number
  tasks: WorkItemOverview[]
  weak: ReadonlyMap<string, WorkItemOverview>
  onSelect: (id: FactId) => void
}) {
  const { t } = useTranslation()
  const current = view.facts.filter(isCurrent)
  const glosses = current.filter((fact) => fact.kind === 'sense')
  const listing =
    view.listing === 'extra'
      ? t('inspector.lessCommon')
      : view.listing === 'unlisted'
        ? t('inspector.notOrdered')
        : null
  return (
    <section
      id={`sense-${view.sense.id}`}
      aria-label={t('inspector.senseLabel', { number })}
      className="flex flex-col gap-3"
    >
      <div className="flex items-baseline gap-3">
        <span className="font-semibold font-serif text-primary text-xl">{number}</span>
        <span className="font-serif text-muted-foreground italic">{t(`pos.${view.sense.pos}`)}</span>
        {listing ? <span className="text-muted-foreground text-xs">{listing}</span> : null}
      </div>
      <div className="flex flex-col gap-1 text-lg">
        {glosses.length === 0 ? <p className="text-muted-foreground text-sm">{t('inspector.noGloss')}</p> : null}
        <Facts facts={glosses} weak={weak} onSelect={onSelect} />
      </div>
      {GROUPS.map((group) => {
        const facts = current.filter((fact) => group.kinds.includes(fact.kind))
        const incoming = group.incoming
          ? view.incoming.filter(
              (fact): fact is Extract<FactDto, { kind: 'relation' }> => fact.kind === 'relation' && isCurrent(fact),
            )
          : []
        const open = tasks.filter((task) => group.tasks.includes(task.type))
        if (facts.length + incoming.length + open.length === 0) return null
        return (
          <Group key={group.key} label={t(`inspector.groups.${group.key}`)}>
            <Facts facts={facts} weak={weak} onSelect={onSelect} />
            {incoming.map((fact) => (
              <IncomingRow key={fact.id} fact={fact} onSelect={onSelect} />
            ))}
            {open.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </Group>
        )
      })}
    </section>
  )
}

function Legend() {
  const { t } = useTranslation()
  const items = [
    { className: 'border-l-primary/50', label: t('factStatus.published') },
    { className: 'border-l-info', label: t('inspector.legend.pending') },
    { className: 'border-l-warning', label: t('factState.flaggedShort') },
    { className: 'border-l-muted-foreground/30', label: t('factStatus.rejected') },
  ]
  return (
    <ul className="flex flex-wrap gap-4 text-muted-foreground text-xs">
      {items.map((item) => (
        <li key={item.label} className={`border-l-2 pl-2 ${item.className}`}>
          {item.label}
        </li>
      ))}
      <li className="rounded-sm border border-dashed px-1.5">{t('inspector.legend.missing')}</li>
    </ul>
  )
}

/** Each sense typeset like a dictionary entry, every fact with its state and every open task where its fact would go. */
export function FactsAndGaps({
  senses,
  tasks,
  onSelect,
}: {
  senses: SenseView[]
  tasks: WorkItemOverview[]
  onSelect: (id: FactId) => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const weak = new Map(
    tasks.flatMap((task) => (task.gap.type === 'weak_fact' ? [[task.gap.fact_id as string, task] as const] : [])),
  )
  const shown = expanded ? senses : senses.slice(0, FIRST_SENSES)
  const entryTasks = tasks.filter((task) => task.type === 'senses')
  return (
    <div className="flex flex-col gap-8">
      <Legend />
      {senses.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">{t('inspector.noSenses')}</p>
          {entryTasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      ) : null}
      {shown.map((view, index) => (
        <SenseBlock
          key={view.sense.id}
          view={view}
          number={index + 1}
          tasks={tasks.filter((task) => task.subject_id === view.sense.id)}
          weak={weak}
          onSelect={onSelect}
        />
      ))}
      {senses.length > FIRST_SENSES ? (
        <Button variant="ghost" className="self-start" onClick={() => setExpanded(!expanded)}>
          <ChevronDown aria-hidden className={expanded ? 'rotate-180' : undefined} />
          {expanded ? t('inspector.showFewer') : t('inspector.showMore', { count: senses.length - FIRST_SENSES })}
        </Button>
      ) : null}
    </div>
  )
}
