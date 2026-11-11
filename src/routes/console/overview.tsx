import { useTranslation } from 'react-i18next'
import { Overview } from '@/features/overview'
import { PageHeader } from '@/shared/ui/page-header'

export default function OverviewPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('overview.title')} subtitle={t('overview.subtitle')} />
      <Overview />
    </div>
  )
}
