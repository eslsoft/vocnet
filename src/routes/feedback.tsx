import { useTranslation } from 'react-i18next'
import { FeedbackBrowser } from '@/features/feedback'
import { PageHeader } from '@/shared/ui/page-header'

export default function FeedbackPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('feedback.title')} subtitle={t('feedback.subtitle')} />
      <FeedbackBrowser />
    </div>
  )
}
