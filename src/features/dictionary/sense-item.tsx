import type { PublicSense } from '@shared/catalog'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { cn } from '@/shared/lib/cn'
import { type ApiSource, useApiPeek } from './api-peek'
import { exampleTranslation, grammarCodes, grammarPatterns, senseAnchor, translationList } from './entry-format'
import { RelationGroups } from './relation-groups'

export function SenseItem({
  sense,
  number,
  highlighted,
  source,
}: {
  sense: PublicSense
  number: number
  highlighted: boolean
  source: ApiSource
}) {
  const { t, i18n } = useTranslation()
  const translations = translationList(sense.translations)
  const codes = sense.grammar ? grammarCodes(sense.grammar) : []
  const patterns = sense.grammar ? grammarPatterns(sense.grammar) : []
  const zh = i18n.language.startsWith('zh')
  const api = useApiPeek(source)
  return (
    <li
      id={senseAnchor(sense.id)}
      className={cn(
        'group/sense relative scroll-mt-28 rounded-lg py-4 pr-2 pl-10 transition-colors',
        highlighted && 'bg-accent/60 ring-1 ring-primary/30',
      )}
    >
      <span
        aria-hidden="true"
        className="absolute top-4 left-2 grid size-6 place-items-center rounded-full bg-primary/10 font-semibold text-primary text-xs tabular-nums"
      >
        {number}
      </span>
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {codes.length > 0 || sense.labels.length > 0 || sense.region ? (
              <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
                {codes.length > 0 ? <span>[{codes.join(', ')}]</span> : null}
                {sense.labels.map((label) => (
                  <span key={label} className="rounded border px-1.5 py-px italic">
                    {label}
                  </span>
                ))}
                {sense.region ? (
                  <span className="rounded border px-1.5 py-px italic">{sense.region.replaceAll('_', ' ')}</span>
                ) : null}
              </p>
            ) : null}
            <p className="font-medium text-[1.0625rem] leading-snug">
              <span className="sr-only">{number}. </span>
              {sense.gloss}
            </p>
            {translations.length > 0 ? (
              <p lang="zh-CN" className="text-muted-foreground">
                {translations.join('；')}
              </p>
            ) : null}
            {patterns.length > 0 ? (
              <p className="flex flex-wrap gap-x-3 gap-y-1 font-medium text-primary text-sm">
                {patterns.map((pattern) => (
                  <span key={pattern}>{pattern}</span>
                ))}
              </p>
            ) : null}
          </div>
          {api.toggle}
        </div>
        {api.panel}
        {sense.examples.length > 0 ? (
          <ul aria-label={t('entry.examples')} className="flex flex-col gap-2">
            {sense.examples.map((example) => (
              <li key={example.text} className="border-border border-l-2 pl-3">
                <p className="text-foreground/90 italic">{example.text}</p>
                {exampleTranslation(example.translation) ? (
                  <p lang="zh-CN" className="text-muted-foreground text-sm">
                    {exampleTranslation(example.translation)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {sense.collocations.length > 0 ? (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {t('entry.collocations')}
            </span>
            {sense.collocations.map((collocation, index) => (
              <span key={collocation.text} className="font-medium">
                {collocation.text}
                {index < sense.collocations.length - 1 ? <span className="text-muted-foreground"> · </span> : null}
              </span>
            ))}
          </div>
        ) : null}
        <RelationGroups relations={sense.relations} />
        {sense.topics.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {t('entry.topics')}
            </span>
            {sense.topics.map((topic) => (
              <Link
                key={topic.id}
                to={`/browse?topic=${encodeURIComponent(topic.id)}`}
                className="rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground text-xs hover:bg-accent hover:text-accent-foreground"
              >
                {(zh ? topic.name.zh : undefined) ?? topic.name.en}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  )
}
