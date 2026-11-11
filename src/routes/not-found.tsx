import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { buttonVariants } from '@/shared/ui/button'

export default function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex max-w-6xl flex-col items-start gap-3 px-4 py-16">
      <h1 className="font-semibold text-2xl tracking-tight">{t('notFoundTitle')}</h1>
      <p className="text-muted-foreground">{t('notFoundBody')}</p>
      <Link to="/" className={buttonVariants()}>
        {t('backHome')}
      </Link>
    </div>
  )
}
