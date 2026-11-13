import type { PublicEntry } from '@shared/catalog'
import type { RelationDomain } from '@shared/facts'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { ApiClientError } from '@/shared/api/client'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Skeleton } from '@/shared/ui/skeleton'
import { DomainSwitch } from './domain-switch'
import { EntryExtras } from './entry-extras'
import { phraseCount } from './entry-format'
import { EntryHeader } from './entry-header'
import { EntryMissing } from './entry-missing'
import { useEntry } from './hooks'
import { MeaningSection } from './meaning-section'

function EntrySkeleton() {
  const { t } = useTranslation()
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only" role="status">
        {t('entry.loading')}
      </span>
      <Skeleton className="h-12 w-56" />
      <Skeleton className="h-5 w-72" />
      <Skeleton className="h-5 w-48" />
      <div className="flex flex-col gap-3 pt-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  )
}

function Contents({ entry }: { entry: PublicEntry }) {
  const { t } = useTranslation()
  const links = [
    ...entry.meanings.map((meaning) => ({
      href: `#${meaning.pos}`,
      label: t(`pos.${meaning.pos}`),
      count: meaning.senses.length,
    })),
    ...(entry.morphology && (entry.morphology.parts.length > 1 || entry.morphology.family.length > 0)
      ? [{ href: '#word-family', label: t('entry.wordFamily'), count: entry.morphology.family.length }]
      : []),
    ...(phraseCount(entry.phrases) > 0
      ? [{ href: '#phrases', label: t('entry.phrases'), count: phraseCount(entry.phrases) }]
      : []),
  ]
  return (
    <nav aria-label={t('entry.contents')} className="flex flex-col gap-1.5">
      <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{t('entry.contents')}</span>
      <ul className="flex flex-col">
        {links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              className="flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-muted"
            >
              {link.label}
              <span className="text-muted-foreground text-xs tabular-nums">{link.count}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Scrolls to the sense a link points at once the entry has rendered, and says which one it is. */
function useSenseTarget(ready: boolean): string | null {
  const { hash } = useLocation()
  const target = hash.startsWith('#sense-') ? hash.slice('#sense-'.length) : null
  useEffect(() => {
    if (!ready || !hash) return
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' })
  }, [ready, hash])
  return target
}

/** A dictionary entry as a learner's dictionary typesets it, every block backed by its slice of the API. */
export function EntryView({ lemma, domain }: { lemma: string; domain: RelationDomain | undefined }) {
  const { t } = useTranslation()
  const query = useEntry(lemma, domain)
  const highlighted = useSenseTarget(query.isSuccess)

  if (query.error instanceof ApiClientError && query.error.code === 'not_found') {
    return (
      <>
        <title>{`${lemma} · ${t('appName')}`}</title>
        <EntryMissing lemma={lemma} />
      </>
    )
  }
  if (query.error) return <ErrorNotice error={query.error} />
  if (!query.data) return <EntrySkeleton />

  const { entry, payload, path } = query.data
  let firstNumber = 1
  const starts = entry.meanings.map((meaning) => {
    const start = firstNumber
    firstNumber += meaning.senses.length
    return start
  })
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <title>{`${entry.lemma} · ${t('appName')}`}</title>
      <article className="flex min-w-0 flex-col gap-10" aria-labelledby="headword">
        <EntryHeader entry={entry} path={path} payload={payload} />
        <DomainSwitch domain={domain} className="lg:hidden" />
        {entry.meanings.map((meaning, index) => (
          <MeaningSection
            key={meaning.pos}
            meaning={meaning}
            index={index}
            firstNumber={starts[index]}
            path={path}
            payload={payload}
            highlighted={highlighted}
          />
        ))}
        <EntryExtras entry={entry} path={path} payload={payload} />
      </article>
      <aside className="hidden lg:block">
        <div className="sticky top-20 flex flex-col gap-6">
          <Contents entry={entry} />
          <DomainSwitch domain={domain} />
          <p className="text-muted-foreground text-xs leading-relaxed">{t('entry.domainHint')}</p>
        </div>
      </aside>
    </div>
  )
}
