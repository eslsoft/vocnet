import { useTranslation } from 'react-i18next'
import { AgentsPanel } from '@/features/agents'
import { PageHeader } from '@/shared/ui/page-header'

export default function AgentsPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('agents.title')} subtitle={t('agents.subtitle')} />
      <AgentsPanel />
    </div>
  )
}
