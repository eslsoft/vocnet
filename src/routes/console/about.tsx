import { useTranslation } from 'react-i18next'

export default function AboutPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-heading text-xl font-semibold">{t('aboutTitle')}</h1>
      <p className="text-muted-foreground text-sm">{t('aboutBody')}</p>
    </div>
  )
}
