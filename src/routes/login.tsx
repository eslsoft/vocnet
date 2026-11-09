import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'
import { isAuthenticated, login } from '@/features/auth'
import { reportBrowserError } from '@/shared/observability/errors'
import { Button } from '@/shared/ui/button'

export default function LoginPage() {
  const { t } = useTranslation()
  const [error, setError] = useState<Error | null>(null)
  if (isAuthenticated()) return <Navigate to="/" replace />

  return (
    <main className="grid min-h-dvh place-items-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-4">
        <h1 className="font-heading text-xl font-semibold">{t('appName')}</h1>
        <Button
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
          {t('signIn')}
        </Button>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error.message}
          </p>
        ) : null}
      </div>
    </main>
  )
}
