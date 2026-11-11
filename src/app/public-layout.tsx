import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, ScrollRestoration } from 'react-router'
import { SourcesNote } from '@/features/dictionary'
import { cn } from '@/shared/lib/cn'
import { buttonVariants } from '@/shared/ui/button'
import { LanguageToggle } from '@/shared/ui/language-toggle'
import { Logo } from '@/shared/ui/logo'
import { SkipLink } from '@/shared/ui/skip-link'
import { ThemeToggle } from '@/shared/ui/theme-toggle'

// The public site shell: the learner- and developer-facing pages, readable without signing in.

const navItems = [
  { to: '/browse', label: 'site.browse' },
  { to: '/developers', label: 'site.developers' },
] as const

function TopNavLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'rounded-md px-2.5 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground',
          isActive && 'text-foreground',
        )
      }
    >
      {children}
    </NavLink>
  )
}

export function PublicLayout({ search }: { search?: ReactNode }) {
  const { t } = useTranslation()
  const nav = navItems.map((item) => (
    <TopNavLink key={item.to} to={item.to}>
      {t(item.label)}
    </TopNavLink>
  ))
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <ScrollRestoration />
      <SkipLink label={t('skipToContent')} />
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6">
          <Link to="/" className="rounded-md" aria-label={`${t('appName')} — ${t('site.home')}`}>
            <Logo />
          </Link>
          <nav aria-label={t('site.primaryNav')} className="hidden items-center gap-1 md:flex">
            {nav}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-1">
            {search ? <div className="hidden w-64 lg:block">{search}</div> : null}
            <LanguageToggle />
            <ThemeToggle />
            <Link to="/console" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-1')}>
              {t('site.console')}
            </Link>
          </div>
        </div>
        <nav aria-label={t('site.primaryNav')} className="mx-auto flex max-w-6xl gap-1 px-2 pb-2 md:hidden">
          {nav}
        </nav>
      </header>
      <main id="main" className="min-h-[calc(100dvh-3.5rem)] flex-1">
        <Outlet />
      </main>
      <footer className="border-t bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-[1.2fr_0.6fr_0.6fr_2fr]">
          <div className="flex flex-col gap-3">
            <Logo />
            <p className="max-w-xs text-muted-foreground text-sm leading-relaxed">{t('site.tagline')}</p>
          </div>
          <FooterLinks
            title={t('site.product')}
            links={[
              { to: '/', label: t('site.home') },
              { to: '/browse', label: t('site.browse') },
              { to: '/console', label: t('site.console') },
            ]}
          />
          <FooterLinks
            title={t('site.resources')}
            links={[
              { to: '/developers', label: t('site.developers') },
              { href: '/docs', label: t('site.apiReference') },
              { href: '/openapi.json', label: t('site.openapi') },
            ]}
          />
          <section aria-labelledby="footer-sources" className="flex flex-col gap-2">
            <h2 id="footer-sources" className="font-semibold text-sm">
              {t('site.dataSources')}
            </h2>
            <SourcesNote />
          </section>
        </div>
      </footer>
    </div>
  )
}

type FooterLink = { label: string } & ({ to: string } | { href: string })

function FooterLinks({ title, links }: { title: string; links: FooterLink[] }) {
  const className = 'text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline'
  return (
    <nav aria-label={title} className="flex flex-col gap-2">
      <h2 className="font-semibold text-sm">{title}</h2>
      <ul className="flex flex-col gap-1.5">
        {links.map((link) => (
          <li key={link.label}>
            {'to' in link ? (
              <Link className={className} to={link.to}>
                {link.label}
              </Link>
            ) : (
              <a className={className} href={link.href}>
                {link.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}
