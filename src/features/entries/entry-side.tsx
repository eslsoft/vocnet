import type { FactDto, FactId, FactKind } from '@shared/facts'
import type { WorkItemOverview } from '@shared/monitor'
import type { LemmaReference } from '@shared/reference'
import type { WorkType } from '@shared/work'
import { useTranslation } from 'react-i18next'
import { FactStateBadge, type SenseView, summarizeFact } from '@/features/facts'
import { TaskStatusBadge } from '@/features/tasks'
import { formatNumber } from '@/shared/lib/format'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { useReferenceSources } from './hooks'

/** The senses in their agreed order, the less common ones and the ones not yet ordered counted apart. */
export function SensesOutline({ senses }: { senses: SenseView[] }) {
  const { t } = useTranslation()
  const extra = senses.filter((view) => view.listing === 'extra').length
  const unordered = senses.filter((view) => view.listing === 'unlisted').length
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('inspector.senses')}</CardTitle>
        <CardDescription>{t('inspector.sensesHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        {senses.length === 0 ? <p className="text-muted-foreground text-sm">{t('inspector.noSenses')}</p> : null}
        <ol className="flex flex-col gap-1.5 text-sm">
          {senses.map((view, index) =>
            view.listing === 'extra' || view.listing === 'unlisted' ? null : (
              <li key={view.sense.id} className="flex gap-3">
                <span className="w-4 shrink-0 text-muted-foreground tabular-nums">{index + 1}</span>
                <span className="min-w-0 truncate font-serif">{view.gloss ?? t('inspector.noGloss')}</span>
              </li>
            ),
          )}
        </ol>
        {extra + unordered > 0 ? (
          <ul className="mt-2 flex flex-col gap-1 text-muted-foreground text-sm">
            {extra > 0 ? <li>{t('inspector.lessCommonCount', { count: extra })}</li> : null}
            {unordered > 0 ? <li>{t('inspector.notOrderedCount', { count: unordered })}</li> : null}
          </ul>
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
  { key: 'phrases', kinds: [], tasks: ['phrases'] },
  { key: 'senseOrder', kinds: ['sense_list'], tasks: ['sense_list'] },
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
            const phrases = task?.gap.type === 'phrases' ? task.gap.have : []
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
                  {phrases.length > 0 ? <span>{phrases.join(' · ')}</span> : null}
                  {current.length === 0 && phrases.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
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
