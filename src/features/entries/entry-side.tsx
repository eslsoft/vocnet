import type { FactDto, FactId, FactKind } from '@shared/facts'
import type { WorkItemOverview } from '@shared/monitor'
import type { LemmaReference } from '@shared/reference'
import type { WorkType } from '@shared/work'
import { useTranslation } from 'react-i18next'
import { FactStateBadge, type InventoryFact, type SenseView, summarizeFact } from '@/features/facts'
import { gapText, TaskStatusBadge } from '@/features/tasks'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { useReferenceSources } from './hooks'

/**
 * The entry's sense inventory in display order: the common senses first, then the extra ones. It
 * is decided once; after it publishes only a curator changes it.
 */
export function InventoryCard({
  inventory,
  senses,
  onSelect,
}: {
  inventory: InventoryFact | null
  senses: SenseView[]
  onSelect: (id: FactId) => void
}) {
  const { t } = useTranslation()
  const unlisted = senses.filter((view) => view.item === null).length
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('inspector.inventory')}</CardTitle>
        <CardDescription>{t('inspector.inventoryHint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {inventory ? (
          <button
            type="button"
            onClick={() => onSelect(inventory.id)}
            className="inline-flex items-center gap-2 self-start text-left text-muted-foreground text-xs hover:underline"
          >
            <FactStateBadge fact={inventory} />
            {t('inspector.inventorySummary', {
              common: inventory.payload.senses.filter((sense) => sense.rank === 'common').length,
              extra: inventory.payload.senses.filter((sense) => sense.rank === 'extra').length,
            })}
          </button>
        ) : (
          <p className="text-muted-foreground text-sm">{t('inspector.noInventory')}</p>
        )}
        <ol className="flex flex-col gap-1.5 text-sm">
          {inventory?.payload.senses.map((sense, index) => (
            <li key={sense.id} className={cn('flex gap-3', sense.rank === 'extra' && 'text-muted-foreground')}>
              <span className="w-4 shrink-0 text-muted-foreground tabular-nums">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="text-muted-foreground italic">{t(`pos.${sense.pos}`)}</span>{' '}
                <span className="font-serif">{sense.gloss}</span>
                {[sense.register, sense.region, sense.rank === 'extra' ? t('inspector.lessCommon') : undefined]
                  .filter(Boolean)
                  .map((label) => (
                    <span key={label} className="ml-1.5 text-muted-foreground text-xs">
                      {label}
                    </span>
                  ))}
              </span>
            </li>
          ))}
        </ol>
        {unlisted > 0 ? (
          <p className="text-muted-foreground text-sm">{t('inspector.notInInventory', { count: unlisted })}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** The rows of Word details: the entry facts each shows and the tasks that fill it. */
const DETAILS: Array<{ key: string; kinds: FactKind[]; tasks: WorkType[] }> = [
  { key: 'pronunciation', kinds: ['pronunciation'], tasks: ['pronunciation'] },
  { key: 'forms', kinds: ['form'], tasks: ['forms', 'form_pronunciations'] },
  { key: 'syllables', kinds: ['syllables'], tasks: ['syllables'] },
  { key: 'formation', kinds: ['morphology'], tasks: ['morphology', 'family'] },
  { key: 'phrases', kinds: ['phrases'], tasks: ['phrases'] },
  { key: 'productiveUse', kinds: ['productive_use'], tasks: ['productive_use'] },
  { key: 'translations', kinds: [], tasks: ['translations'] },
]

const isCurrent = (fact: FactDto) => fact.status === 'pending' || fact.status === 'published'

/** The entry's own facts, a row each, with the task that is filling a row still missing one. */
export function WordDetails({
  facts,
  tasks,
  onSelect,
}: {
  facts: FactDto[]
  tasks: WorkItemOverview[]
  onSelect: (id: FactId) => void
}) {
  const { t } = useTranslation()
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('inspector.wordDetails')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2.5 text-sm">
          {DETAILS.map((row) => {
            const current = facts.filter((fact) => row.kinds.includes(fact.kind) && isCurrent(fact))
            const task = tasks.find((candidate) => row.tasks.includes(candidate.type))
            return (
              <div key={row.key} className="contents">
                <dt className="text-muted-foreground text-xs leading-5">{t(`inspector.details.${row.key}`)}</dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  {current.map((fact) => (
                    <button
                      key={fact.id}
                      type="button"
                      onClick={() => onSelect(fact.id)}
                      className="inline-flex items-center gap-1.5 text-left hover:underline"
                    >
                      {summarizeFact(fact)}
                      {fact.status === 'published' && fact.review?.verdict === 'pass' ? null : (
                        <FactStateBadge fact={fact} />
                      )}
                    </button>
                  ))}
                  {current.length === 0 ? (
                    <span className="text-muted-foreground">{task ? gapText(task.gap, t) : '—'}</span>
                  ) : null}
                  {task ? (
                    <span className="ml-auto">
                      <TaskStatusBadge status={task.status} />
                    </span>
                  ) : null}
                </dd>
              </div>
            )
          })}
        </dl>
      </CardContent>
    </Card>
  )
}

/** Imported frequency and CEFR data, with the attribution of each source it came from. */
export function ReferenceData({ frequency, cefr }: LemmaReference) {
  const { t, i18n } = useTranslation()
  const sources = useReferenceSources()
  const used = new Set([frequency?.source_id, ...cefr.map((item) => item.source_id)])
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('inspector.reference')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2">
          <dt className="text-muted-foreground text-xs leading-5">{t('inspector.frequency')}</dt>
          <dd>
            {frequency
              ? t('inspector.rank', { rank: formatNumber(frequency.rank, i18n.language) })
              : t('inspector.notListed')}
          </dd>
          <dt className="text-muted-foreground text-xs leading-5">{t('inspector.cefr')}</dt>
          <dd>
            {cefr.length === 0
              ? t('inspector.notListed')
              : cefr.map((item) => `${t(`pos.${item.pos}`)} ${item.level}`).join(' · ')}
          </dd>
        </dl>
        <ErrorNotice error={sources.error} />
        {sources.data?.items
          .filter((source) => used.has(source.id))
          .map((source) => (
            <p className="text-muted-foreground text-xs" key={source.id}>
              {t('inspector.source', { name: `${source.name} ${source.version}` })} — {source.attribution} (
              <a className="underline" href={source.license_url} rel="noreferrer" target="_blank">
                {source.license}
              </a>
              ). {source.changes}
            </p>
          ))}
      </CardContent>
    </Card>
  )
}
