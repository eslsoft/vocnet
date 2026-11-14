import type { Meaning } from '@shared/catalog'
import type { CefrLevel } from '@shared/reference'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { frequencyBand } from './entry-format'

const LEVEL_TONE: Record<string, string> = {
  A: 'bg-emerald-50 text-emerald-800 ring-emerald-700/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-300/25',
  B: 'bg-sky-50 text-sky-800 ring-sky-700/20 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-300/25',
  C: 'bg-violet-50 text-violet-800 ring-violet-700/20 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-violet-300/25',
}

/** A CEFR level as a learner's dictionary marks it. */
export function CefrBadge({ level, className }: { level: CefrLevel; className?: string }) {
  const { t } = useTranslation()
  return (
    <abbr
      title={t('entry.cefrTitle', { level })}
      className={cn(
        'inline-flex h-5 items-center rounded px-1.5 font-semibold text-[0.6875rem] tracking-wide no-underline ring-1 ring-inset',
        LEVEL_TONE[level[0]],
        className,
      )}
    >
      {level}
    </abbr>
  )
}

/** Whether native speakers and an advanced learner use the word in this part of speech or only understand it. */
export function ProductiveUseBadges({ use, skills }: { use: Meaning['productive_use']; skills: Meaning['skills'] }) {
  const { t } = useTranslation()
  if (!use || !skills) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      {(['native', 'learner'] as const).map((tier) => (
        <span
          key={tier}
          title={skills[tier].map((skill) => t(`entry.skill.${skill}`)).join(' · ')}
          className="inline-flex h-5 items-center rounded px-1.5 text-muted-foreground ring-1 ring-border ring-inset"
        >
          {t(`entry.tier.${tier}`)} · {t(use[tier] ? 'entry.active' : 'entry.passive')}
        </span>
      ))}
    </span>
  )
}

/** Five bars for the frequency band, with the Zipf value and rank for those who want the number. */
export function FrequencyMeter({ zipf, rank }: { zipf: number; rank: number }) {
  const { t } = useTranslation()
  const band = frequencyBand(zipf)
  const label = t(`entry.band.${band}`)
  return (
    <span className="inline-flex items-center gap-2" title={t('entry.frequencyValue', { zipf, rank })}>
      <span className="flex items-end gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((bar) => (
          <span
            key={bar}
            className={cn('w-1 rounded-sm', bar <= band ? 'bg-primary' : 'bg-border')}
            style={{ height: `${4 + bar * 2}px` }}
          />
        ))}
      </span>
      <span>
        {label}
        <span className="sr-only">, {t('entry.frequencyValue', { zipf, rank })}</span>
      </span>
    </span>
  )
}
