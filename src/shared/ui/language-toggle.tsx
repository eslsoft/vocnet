import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { languages } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'

export function LanguageToggle() {
  const { i18n } = useTranslation()
  const next = () => {
    const index = languages.findIndex((language) => language.value === i18n.language)
    void i18n.changeLanguage(languages[(index + 1) % languages.length].value)
  }
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Switch language" onClick={next}>
      <Languages />
    </Button>
  )
}
