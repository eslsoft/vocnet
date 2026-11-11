import type { PublicEntry } from '@shared/catalog'
import type { CefrLevel } from '@shared/reference'
import { useTranslation } from 'react-i18next'
import { useApiPeek } from './api-peek'
import { CefrBadge, FrequencyMeter } from './badges'
import { Pronunciations } from './meaning-section'

const LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const HEADER_FIELDS = ['lemma', 'syllables', 'pronunciations', 'frequency', 'variants']

/** The headword block: spelling, syllables, pronunciations, level, frequency, and variants. */
export function EntryHeader({ entry, path, payload }: { entry: PublicEntry; path: string; payload: unknown }) {
  const { t } = useTranslation()
  const levels = [...new Set(entry.meanings.flatMap((meaning) => (meaning.cefr ? [meaning.cefr] : [])))].sort(
    (a, b) => LEVELS.indexOf(a) - LEVELS.indexOf(b),
  )
  const api = useApiPeek({ path, payload, slice: [], pick: HEADER_FIELDS })
  const parts = [...new Set(entry.meanings.map((meaning) => t(`pos.${meaning.pos}`)))]
  return (
    <header className="flex flex-col gap-4 border-b pb-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 id="headword" className="break-words font-serif font-semibold text-4xl tracking-tight sm:text-5xl">
            {entry.lemma}
          </h1>
          <p className="text-muted-foreground">
            {entry.syllables && entry.syllables.length > 1 ? (
              <span className="mr-3 font-serif tracking-wide" title={t('entry.syllables')}>
                {entry.syllables.join('·')}
              </span>
            ) : null}
            <span className="italic">{parts.join(', ')}</span>
          </p>
        </div>
        {api.toggle}
      </div>
      {api.panel}
      <Pronunciations items={entry.pronunciations} />
      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
        {levels.length > 0 ? (
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground text-xs">{t('entry.level')}</dt>
            <dd className="flex gap-1">
              {levels.map((level) => (
                <CefrBadge key={level} level={level} />
              ))}
            </dd>
          </div>
        ) : null}
        {entry.frequency ? (
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground text-xs">{t('entry.frequency')}</dt>
            <dd>
              <FrequencyMeter zipf={entry.frequency.zipf} rank={entry.frequency.rank} />
            </dd>
          </div>
        ) : null}
        {entry.variants.length > 0 ? (
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground text-xs">{t('entry.variants')}</dt>
            <dd className="font-medium">{entry.variants.map((variant) => variant.form).join(', ')}</dd>
          </div>
        ) : null}
      </dl>
    </header>
  )
}
