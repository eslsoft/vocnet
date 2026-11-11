import { ArrowLeft, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router'
import { isAuthenticated, login } from '@/features/auth'
import { reportBrowserError } from '@/shared/observability/errors'
import { Button } from '@/shared/ui/button'
import { Logo } from '@/shared/ui/logo'

export default function LoginPage() {
  const { t } = useTranslation()
  const [error, setError] = useState<Error | null>(null)
  if (isAuthenticated()) return <Navigate to="/console" replace />

  return (
    <main className="grid min-h-dvh place-items-center bg-surface px-4 text-foreground">
      <title>{`${t('signIn')} · ${t('console.title')} · ${t('appName')}`}</title>
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link to="/" className="self-center rounded-md">
          <Logo suffix={t('console.title')} />
        </Link>
        <div className="flex flex-col gap-5 rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-semibold text-xl tracking-tight">{t('login.title')}</h1>
            <p className="text-muted-foreground text-sm">{t('login.body')}</p>
          </div>
          <Button
            size="lg"
            className="w-full"
            onClick={async () => {
              try {
                await login()
              } catch (cause) {
                const error = cause instanceof Error ? cause : new Error('Sign-in failed.', { cause })
                reportBrowserError(error, 'oidc.login')
                setError(error)
              }
            }}
          >
            <LockKeyhole aria-hidden="true" />
            {t('signIn')}
          </Button>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error.message}
            </p>
          ) : null}
        </div>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 self-center text-muted-foreground text-sm hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('console.backToSite')}
        </Link>
      </div>
    </main>
  )
}
