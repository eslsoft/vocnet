import { Monitor, Moon, Sun } from 'lucide-react'
import { type Theme, useTheme } from '@/shared/theme/provider'
import { Button } from '@/shared/ui/button'

const ORDER: Theme[] = ['light', 'dark', 'system']
const ICON = { light: Sun, dark: Moon, system: Monitor }

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const Icon = ICON[theme]
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Theme: ${theme}`}
      onClick={() => setTheme(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length])}
    >
      <Icon />
    </Button>
  )
}
