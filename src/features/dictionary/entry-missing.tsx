import { SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Skeleton } from '@/shared/ui/skeleton'
import { wordPath } from './entry-format'
import { useSearch } from './hooks'

const SUGGESTIONS = 8

/** An exact lookup found nothing: say so, and offer what a search for the same text finds. */
export function EntryMissing({ lemma }: { lemma: string }) {
  const { t } = useTranslation()
  const search = useSearch(lemma, SUGGESTIONS)
  return (
    <div className="flex flex-col gap-6 py-6">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <SearchX aria-hidden="true" className="size-5" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="font-semibold text-2xl tracking-tight">{t('entry.missingTitle')}</h1>
          <p className="max-w-prose text-muted-foreground">{t('entry.missingBody', { lemma })}</p>
        </div>
      </div>
      <section aria-labelledby="suggestions-title" className="flex flex-col gap-3">
        <h2 id="suggestions-title" className="font-medium text-muted-foreground text-sm">
          {t('entry.suggestions', { q: lemma })}
        </h2>
        <ErrorNotice error={search.error} />
        {search.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : null}
        {search.data && search.data.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('entry.noSuggestions')}</p>
        ) : null}
        {search.data && search.data.items.length > 0 ? (
          <ul className="flex flex-col divide-y rounded-lg border">
            {search.data.items.map((hit) => (
              <li key={hit.lemma}>
                <Link to={wordPath(hit.lemma)} className="flex flex-col gap-0.5 px-4 py-3 hover:bg-muted">
                  <span className="font-medium font-serif text-lg">{hit.lemma}</span>
                  {hit.gloss ? <span className="line-clamp-1 text-muted-foreground text-sm">{hit.gloss}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  )
}
