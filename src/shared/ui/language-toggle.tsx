import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { languages } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'

export function LanguageToggle() {
  const { i18n } = useTranslation()
  const index = languages.findIndex((language) => language.value === i18n.language)
  const next = languages[(index + 1) % languages.length]
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Switch language to ${next.label}`}
      lang={next.value}
      onClick={() => void i18n.changeLanguage(next.value)}
    >
      <Languages aria-hidden="true" />
      <span className="hidden sm:inline">{next.label}</span>
    </Button>
  )
}
