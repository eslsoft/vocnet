import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { EntryInspector, EntryList } from '@/features/entries'
import { PageHeader } from '@/shared/ui/page-header'

export default function EntriesPage() {
  const { t } = useTranslation()
  const { lemma } = useParams()
  return (
    <div className="flex flex-col gap-6">
      {lemma ? (
        <>
          <PageHeader title={t('entries.title')} subtitle={t('entries.subtitle')} />
          <EntryInspector lemma={lemma} />
        </>
      ) : (
        <>
          <PageHeader title={t('entries.listTitle')} subtitle={t('entries.listSubtitle')} />
          <EntryList />
        </>
      )}
    </div>
  )
}
