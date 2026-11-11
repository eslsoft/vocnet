import { LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { completeLogin } from '@/features/auth'
import { reportBrowserError } from '@/shared/observability/errors'

export default function CallbackPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [error, setError] = useState<Error | null>(null)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    completeLogin()
      .then(() => navigate('/console', { replace: true }))
      .catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error('OIDC callback failed.', { cause })
        reportBrowserError(error, 'oidc.callback')
        setError(error)
      })
  }, [navigate])

  return (
    <main className="grid min-h-dvh place-items-center bg-surface px-4 text-muted-foreground text-sm">
      {error ? (
        <div className="flex flex-col items-center gap-3">
          <p role="alert" className="text-destructive">
            {error.message}
          </p>
          <Link to="/login" className="text-primary hover:underline">
            {t('signIn')}
          </Link>
        </div>
      ) : (
        <p role="status" className="flex items-center gap-2">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          {t('login.signingIn')}
        </p>
      )}
    </main>
  )
}
