import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { buttonVariants } from '@/shared/ui/button'

export default function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="font-heading text-xl font-semibold">{t('notFoundTitle')}</h1>
      <p className="text-muted-foreground text-sm">{t('notFoundBody')}</p>
      <Link to="/" className={buttonVariants()}>
        {t('backHome')}
      </Link>
    </div>
  )
}
