import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { type Language, languageSchema, readLanguage, writeLanguage } from '@/shared/persistence/language'
import { enUS } from './locales/en-US'
import { zhCN } from './locales/zh-CN'

export const languages = [
  { value: 'en-US', label: 'English' },
  { value: 'zh-CN', label: '中文' },
] as const satisfies ReadonlyArray<{ value: Language; label: string }>

const resources = {
  'en-US': { translation: enUS },
  'zh-CN': { translation: zhCN },
}

i18n.use(initReactI18next).init({
  resources,
  lng: readLanguage(navigator.languages),
  fallbackLng: 'en-US',
  interpolation: { escapeValue: false },
})

i18n.on('languageChanged', (language) => {
  writeLanguage(languageSchema.parse(language))
  document.documentElement.lang = language
})
document.documentElement.lang = i18n.language

export default i18n
