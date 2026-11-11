import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { buttonVariants } from '@/shared/ui/button'

export default function HomePage() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:py-24">
      <h1 className="max-w-3xl font-semibold text-4xl tracking-tight sm:text-5xl">{t('site.tagline')}</h1>
      <div className="flex gap-3">
        <Link to="/browse" className={buttonVariants({ size: 'lg' })}>
          {t('site.browse')}
        </Link>
        <Link to="/developers" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
          {t('site.developers')}
        </Link>
      </div>
    </div>
  )
}
