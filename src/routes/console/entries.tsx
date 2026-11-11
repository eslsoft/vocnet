import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { EntryInspector, EntryList } from '@/features/entries'
import { entryTotal, useConsoleStats } from '@/features/overview'
import { formatNumber } from '@/shared/lib/format'
import { PageHeader } from '@/shared/ui/page-header'

export default function EntriesPage() {
  const { t, i18n } = useTranslation()
  const { lemma } = useParams()
  const stats = useConsoleStats()
  if (lemma) return <EntryInspector key={lemma} lemma={lemma} />
  const total = stats.data ? formatNumber(entryTotal(stats.data), i18n.language) : null
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('entries.title')}
        subtitle={total === null ? t('entries.subtitle') : t('entries.subtitleCount', { total })}
      />
      <EntryList />
    </div>
  )
}
