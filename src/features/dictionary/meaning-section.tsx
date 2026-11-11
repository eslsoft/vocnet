import type { InflectionType, Meaning, PublicPronunciation } from '@shared/catalog'
import { useTranslation } from 'react-i18next'
import { useApiPeek } from './api-peek'
import { CefrBadge } from './badges'
import { SenseItem } from './sense-item'

const FORM_ORDER: InflectionType[] = [
  'plural',
  'third_person_singular',
  'present_participle',
  'past',
  'past_participle',
  'comparative',
  'superlative',
]

export function Pronunciations({ items }: { items: PublicPronunciation[] }) {
  const { t } = useTranslation()
  if (items.length === 0) return null
  const ordered = [...items].sort((a, b) => (a.accent === b.accent ? 0 : a.accent === 'uk' ? -1 : 1))
  return (
    <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {ordered.map((item) => (
        <span key={`${item.accent}-${item.ipa}-${item.strength ?? ''}`} className="inline-flex items-baseline gap-1.5">
          <abbr
            title={t(`entry.accent.${item.accent}`)}
            className="font-semibold text-muted-foreground text-xs no-underline"
          >
            {item.accent.toUpperCase()}
          </abbr>
          <span className="font-mono text-[0.95rem]">/{item.ipa}/</span>
          {item.strength === 'weak' ? <span className="text-muted-foreground text-xs">{t('entry.weak')}</span> : null}
        </span>
      ))}
    </p>
  )
}

export function MeaningSection({
  meaning,
  index,
  firstNumber,
  path,
  payload,
  highlighted,
}: {
  meaning: Meaning
  index: number
  firstNumber: number
  path: string
  payload: unknown
  highlighted: string | null
}) {
  const { t } = useTranslation()
  const common = meaning.senses.filter((sense) => !sense.rare)
  const rare = meaning.senses.filter((sense) => sense.rare)
  const forms = FORM_ORDER.filter((type) => meaning.forms[type]?.length)
  const item = (sense: Meaning['senses'][number]) => {
    const at = meaning.senses.indexOf(sense)
    return (
      <SenseItem
        key={sense.id}
        sense={sense}
        number={firstNumber + at}
        highlighted={highlighted === sense.id}
        source={{ path, payload, slice: ['meanings', index, 'senses', at] }}
      />
    )
  }
  const headingId = `meaning-${index}`
  const api = useApiPeek({ path, payload, slice: ['meanings', index] })
  return (
    <section aria-labelledby={headingId} id={meaning.pos} className="scroll-mt-24">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-3">
        <h2 id={headingId} className="font-serif text-2xl italic">
          {t(`pos.${meaning.pos}`)}
        </h2>
        {meaning.cefr ? <CefrBadge level={meaning.cefr} /> : null}
        {forms.length > 0 ? (
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {forms.map((type) => (
              <div key={type} className="flex items-baseline gap-1.5">
                <dt className="text-muted-foreground text-xs">{t(`entry.forms.${type}`)}</dt>
                <dd className="font-medium">
                  {meaning.forms[type]?.map((form, position) => (
                    <span key={form.form}>
                      {position > 0 ? ', ' : ''}
                      {form.form}
                      {form.irregular ? (
                        <abbr title={t('entry.irregular')} className="ml-0.5 text-highlight no-underline">
                          *
                        </abbr>
                      ) : null}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        <span className="ml-auto">{api.toggle}</span>
      </header>
      {api.panel ? <div className="pt-3">{api.panel}</div> : null}
      {meaning.pronunciations.length > 0 ? (
        <div className="pt-3">
          <Pronunciations items={meaning.pronunciations} />
        </div>
      ) : null}
      <ol className="flex flex-col divide-y divide-border/70">{common.map(item)}</ol>
      {rare.length > 0 ? (
        <details
          className="group mt-2 rounded-lg border border-dashed"
          open={rare.some((sense) => sense.id === highlighted)}
        >
          <summary className="cursor-pointer select-none rounded-lg px-3 py-2 text-muted-foreground text-sm hover:bg-muted">
            {t('entry.rareSenses', { count: rare.length })}
          </summary>
          <ol className="flex flex-col divide-y divide-border/70 px-1">{rare.map(item)}</ol>
        </details>
      ) : null}
    </section>
  )
}
