import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { completeLogin } from '@/features/auth'
import { reportBrowserError } from '@/shared/observability/errors'

export default function CallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<Error | null>(null)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    completeLogin()
      .then(() => navigate('/', { replace: true }))
      .catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error('OIDC callback failed.', { cause })
        reportBrowserError(error, 'oidc.callback')
        setError(error)
      })
  }, [navigate])

  return (
    <div className="grid min-h-dvh place-items-center text-muted-foreground text-sm">
      {error ? error.message : 'Signing in…'}
    </div>
  )
}
