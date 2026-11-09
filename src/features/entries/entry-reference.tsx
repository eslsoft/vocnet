import type { LemmaReference } from '@shared/reference'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { useReferenceSources } from './hooks'

/** Imported frequency and CEFR data, with the attribution of each source it came from. */
export function EntryReference({ frequency, cefr }: LemmaReference) {
  const { t } = useTranslation()
  const sources = useReferenceSources()
  const used = new Set([frequency?.source_id, ...cefr.map((item) => item.source_id)])
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('entries.reference')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">{t('entries.frequency')}</dt>
          <dd>
            {frequency
              ? t('entries.frequencyValue', { zipf: frequency.zipf, rank: frequency.rank.toLocaleString() })
              : t('entries.notListed')}
          </dd>
          <dt className="text-muted-foreground">{t('entries.cefr')}</dt>
          <dd className="flex flex-wrap gap-2">
            {cefr.length === 0 ? t('entries.notListed') : null}
            {cefr.map((item) => (
              <Badge key={item.pos} variant="outline">
                {item.pos} {item.level}
              </Badge>
            ))}
          </dd>
        </dl>
        {sources.error ? <ErrorNotice error={sources.error} /> : null}
        {sources.data?.items
          .filter((source) => used.has(source.id))
          .map((source) => (
            <p className="text-muted-foreground text-xs" key={source.id}>
              {t('entries.source', { name: `${source.name} ${source.version}` })} — {source.attribution} (
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
