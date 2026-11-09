import { useTranslation } from 'react-i18next'
import { FactsBrowser } from '@/features/facts'
import { PageHeader } from '@/shared/ui/page-header'

export default function FactsPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('facts.title')} subtitle={t('facts.subtitle')} />
      <FactsBrowser />
    </div>
  )
}
