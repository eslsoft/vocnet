import { ArrowLeft, BookOpenText, Bot, Gauge, Info, ListChecks, LogOut, MessageSquareWarning } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { logout } from '@/features/auth'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/button'
import { LanguageToggle } from '@/shared/ui/language-toggle'
import { Logo } from '@/shared/ui/logo'
import { SkipLink } from '@/shared/ui/skip-link'
import { ThemeToggle } from '@/shared/ui/theme-toggle'

// The console shell: a sidebar of the back-office pages, which all need an admin sign-in.
const navItems = [
  { to: '/console', label: 'nav.overview', end: true, icon: Gauge },
  { to: '/console/facts', label: 'nav.facts', end: true, icon: ListChecks },
  { to: '/console/entries', label: 'nav.entries', end: false, icon: BookOpenText },
  { to: '/console/feedback', label: 'nav.feedback', end: true, icon: MessageSquareWarning },
  { to: '/console/agents', label: 'nav.agents', end: true, icon: Bot },
  { to: '/console/about', label: 'nav.about', end: true, icon: Info },
] as const

function SideLink({ to, end, children }: { to: string; end: boolean; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:size-4',
          isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
        )
      }
    >
      {children}
    </NavLink>
  )
}

export function ConsoleLayout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
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
          <div className="ml-auto flex items-center lg:hidden">
            <LanguageToggle />
            <ThemeToggle />
            <Button variant="ghost" size="icon" aria-label={t('signOut')} onClick={signOut}>
              <LogOut aria-hidden="true" />
            </Button>
          </div>
        </div>
        <nav
          aria-label={t('console.nav')}
          className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:pt-2"
        >
          {navItems.map(({ icon: Icon, ...item }) => (
            <SideLink key={item.to} to={item.to} end={item.end}>
              <Icon aria-hidden="true" />
              {t(item.label)}
            </SideLink>
          ))}
        </nav>
        <div className="hidden flex-col gap-1 border-t border-sidebar-border p-3 lg:flex">
          <Link
            to="/"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-muted-foreground text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:size-4"
          >
            <ArrowLeft aria-hidden="true" />
            {t('console.backToSite')}
          </Link>
          <div className="flex items-center gap-1">
            <LanguageToggle />
            <ThemeToggle />
            <Button variant="ghost" size="sm" className="ml-auto" onClick={signOut}>
              <LogOut aria-hidden="true" />
              {t('signOut')}
            </Button>
          </div>
        </div>
      </aside>
      <main id="main" className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
