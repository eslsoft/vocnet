import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { enUS } from './locales/en-US'
import { zhCN } from './locales/zh-CN'

export const languages = [
  { value: 'en-US', label: 'English' },
  { value: 'zh-CN', label: '中文' },
] as const

const resources = {
  'en-US': { translation: enUS },
  'zh-CN': { translation: zhCN },
}

i18n.use(initReactI18next).init({
  resources,
  lng: 'en-US',
  fallbackLng: 'en-US',
  interpolation: { escapeValue: false },
})

export default i18n
