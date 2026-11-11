import { useTranslation } from 'react-i18next'
import { KeysPanel } from '@/features/keys'
import { PageHeader } from '@/shared/ui/page-header'

export default function KeysPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('keys.title')} subtitle={t('keys.subtitle')} />
      <KeysPanel />
    </div>
  )
}
