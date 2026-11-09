import { useTranslation } from 'react-i18next'

export default function HomePage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-heading text-xl font-semibold">{t('homeTitle')}</h1>
      <p className="text-muted-foreground text-sm">{t('homeBody')}</p>
    </div>
  )
}
