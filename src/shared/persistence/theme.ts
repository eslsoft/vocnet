import { z } from 'zod'

const STORAGE_KEY = 'vocnet:theme'

const storedThemeSchema = z.object({
  version: z.literal(1),
  theme: z.enum(['light', 'dark', 'system']),
})

export type Theme = z.infer<typeof storedThemeSchema>['theme']

export function readTheme(): Theme {
  const serialized = localStorage.getItem(STORAGE_KEY)
  if (serialized === null) return 'system'

  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch (cause) {
    throw new Error('Stored theme is not valid JSON.', { cause })
  }
  return storedThemeSchema.parse(value).theme
}

export function writeTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, theme }))
}
