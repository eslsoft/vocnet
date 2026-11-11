import { useTranslation } from 'react-i18next'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { useSources } from './hooks'

/** The attribution every page that shows frequency or CEFR data owes its sources (GET /v1/sources). */
export function SourcesNote() {
  const { t } = useTranslation()
  const sources = useSources()
  return (
    <div className="flex flex-col gap-2 text-muted-foreground text-xs leading-relaxed">
      <p>{t('site.licence')}</p>
      {sources.error ? <ErrorNotice error={sources.error} /> : null}
      <ul className="flex min-h-10 flex-col gap-1.5" aria-busy={sources.isPending}>
        {sources.isPending ? <li>{t('site.sourcesLoading')}</li> : null}
        {sources.data?.items.map((source) => (
          <li key={source.id}>
            <details className="group">
              <summary className="cursor-pointer list-none rounded-sm marker:hidden [&::-webkit-details-marker]:hidden">
                <span className="font-medium text-foreground">{source.name}</span> {source.version} ·{' '}
                <span className="underline decoration-dotted underline-offset-4">{source.license}</span>
              </summary>
              <p className="mt-1 pl-3">
                {source.attribution}{' '}
                <a
                  className="text-foreground underline underline-offset-4"
                  href={source.license_url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {t('site.licenceTerms')}
                </a>
              </p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  )
}
