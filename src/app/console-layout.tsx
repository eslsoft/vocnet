import {
  BookOpenText,
  Braces,
  FileText,
  Gauge,
  KeyRound,
  ListChecks,
  ListTodo,
  LogOut,
  Menu,
  MessageSquareWarning,
  SquareLibrary,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { logout } from '@/features/auth'
import { entryTotal, flaggedTotal, useConsoleStats } from '@/features/overview'
import { cn } from '@/shared/lib/cn'
import { formatNumber } from '@/shared/lib/format'
import { Avatar, AvatarFallback } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { LanguageToggle } from '@/shared/ui/language-toggle'
import { Logo } from '@/shared/ui/logo'
import { Separator } from '@/shared/ui/separator'
import { SkipLink } from '@/shared/ui/skip-link'
import { ThemeToggle } from '@/shared/ui/theme-toggle'

type Tone = 'muted' | 'warning' | 'destructive'

const toneClass: Record<Tone, string> = {
  muted: 'text-muted-foreground',
  warning: 'font-medium text-warning-foreground',
  destructive: 'font-medium text-destructive',
}

function SideLink({
  to,
  end,
  icon,
  label,
  count,
  onNavigate,
}: {
  to: string
  end: boolean
  icon: ReactNode
  label: string
  count?: { text: string; tone: Tone }
  onNavigate: () => void
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0',
          isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
        )
      }
    >
      {icon}
      <span className="flex-1">{label}</span>
      {count ? <span className={cn('text-xs tabular-nums', toneClass[count.tone])}>{count.text}</span> : null}
    </NavLink>
  )
}

function useNavCounts() {
  const { t, i18n } = useTranslation()
  const stats = useConsoleStats().data
  if (!stats) return {}
  const number = (value: number) => formatNumber(value, i18n.language)
  const flagged = flaggedTotal(stats)
  return {
    entries: { text: number(entryTotal(stats)), tone: 'muted' as const },
    facts: { text: t('nav.flagged', { count: flagged, formatted: number(flagged) }), tone: 'warning' as const },
    tickets: {
      text: t('nav.open', { count: stats.feedback.open, formatted: number(stats.feedback.open) }),
      tone: 'muted' as const,
    },
    tasks: {
      text: t('nav.stuck', { count: stats.work.stuck, formatted: number(stats.work.stuck) }),
      tone: stats.work.stuck > 0 ? ('destructive' as const) : ('muted' as const),
    },
  }
}

const resourceClass =
  'flex items-center gap-2.5 rounded-md px-2.5 py-1 text-muted-foreground text-xs hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-3.5'

// The console shell: a sidebar of the back-office pages, which all need an admin sign-in.
export function ConsoleLayout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const counts = useNavCounts()
  const close = () => setMenuOpen(false)
  const signOut = () => {
    void logout().finally(() => navigate('/', { replace: true }))
  }
  return (
    <div className="min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-[15rem_1fr]">
      <SkipLink label={t('skipToContent')} />
      <aside className="border-b bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex h-14 items-center gap-2 px-4">
          <Link to="/console" className="rounded-md">
            <Logo suffix={t('console.title')} />
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto lg:hidden"
            aria-label={t('console.menu')}
            aria-expanded={menuOpen}
            aria-controls="console-sidebar"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu aria-hidden />
          </Button>
        </div>
        <div
          id="console-sidebar"
          className={cn('flex-col gap-4 px-3 pb-3 lg:flex lg:flex-1 lg:overflow-y-auto', menuOpen ? 'flex' : 'hidden')}
        >
          <nav aria-label={t('console.nav')} className="flex flex-col gap-0.5 pt-2">
            <SideLink to="/console" end icon={<Gauge aria-hidden />} label={t('nav.overview')} onNavigate={close} />
            <SideLink
              to="/console/entries"
              end={false}
              icon={<BookOpenText aria-hidden />}
              label={t('nav.entries')}
              count={counts.entries}
              onNavigate={close}
            />
            <SideLink
              to="/console/facts"
              end
              icon={<ListChecks aria-hidden />}
              label={t('nav.facts')}
              count={counts.facts}
              onNavigate={close}
            />
            <SideLink
              to="/console/tickets"
              end
              icon={<MessageSquareWarning aria-hidden />}
              label={t('nav.tickets')}
              count={counts.tickets}
              onNavigate={close}
            />
            <SideLink
              to="/console/tasks"
              end={false}
              icon={<ListTodo aria-hidden />}
              label={t('nav.tasks')}
              count={counts.tasks}
              onNavigate={close}
            />
            <SideLink to="/console/keys" end icon={<KeyRound aria-hidden />} label={t('nav.keys')} onNavigate={close} />
          </nav>
          <nav aria-label={t('console.resources')} className="mt-auto flex flex-col gap-0.5">
            <Link to="/" className={resourceClass}>
              <SquareLibrary aria-hidden />
              {t('nav.publicDictionary')}
            </Link>
            <Link to="/developers" className={resourceClass}>
              <Braces aria-hidden />
              {t('nav.developerGuide')}
            </Link>
            <a href="/docs" className={resourceClass}>
              <FileText aria-hidden />
              {t('nav.apiReference')}
            </a>
          </nav>
          <Separator className="bg-sidebar-border" />
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2.5 px-1">
              <Avatar size="sm">
                <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground">A</AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="font-medium text-sm">{t('console.user')}</span>
                <span className="text-muted-foreground text-xs">{t('console.role')}</span>
              </span>
              <Button variant="ghost" size="icon-sm" aria-label={t('signOut')} title={t('signOut')} onClick={signOut}>
                <LogOut aria-hidden />
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </aside>
      <main id="main" className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
