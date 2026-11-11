import { z } from 'zod'

const STORAGE_KEY = 'vocnet:language'

export const languageSchema = z.enum(['en-US', 'zh-CN'])
export type Language = z.infer<typeof languageSchema>

const storedLanguageSchema = z.object({ version: z.literal(1), language: languageSchema })

/** The stored choice, else the browser's preference: Chinese for any zh tag, English otherwise. */
export function readLanguage(preferred: readonly string[]): Language {
  const serialized = localStorage.getItem(STORAGE_KEY)
  if (serialized === null) return preferred[0]?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'

  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch (cause) {
    throw new Error('Stored language is not valid JSON.', { cause })
  }
  return storedLanguageSchema.parse(value).language
}

export function writeLanguage(language: Language): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, language }))
}
