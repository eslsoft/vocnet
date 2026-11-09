import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { ErrorBoundary } from '@/app/error-boundary'
import { Providers } from '@/app/providers'
import { router } from '@/app/router'
import { loadConfig } from '@/shared/config'
import '@/shared/i18n'
import { installBrowserErrorBoundary, reportBrowserError } from '@/shared/observability/errors'
import '@/styles/globals.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found.')
installBrowserErrorBoundary()

// Load runtime config (from the backend) before rendering, so OIDC is configured.
loadConfig()
  .then(() => {
    createRoot(root).render(
      <StrictMode>
        <ErrorBoundary>
          <Providers>
            <RouterProvider router={router} />
          </Providers>
        </ErrorBoundary>
      </StrictMode>,
    )
  })
  .catch((error) => {
    reportBrowserError(error, 'bootstrap')
    root.textContent = 'Failed to load application config.'
  })
