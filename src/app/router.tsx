import { createBrowserRouter } from 'react-router'
import { ConsoleLayout } from '@/app/console-layout'
import { PublicLayout } from '@/app/public-layout'
import { requireAuthLoader } from '@/features/auth'
import { RouteError } from '@/routes/error'

// Route-level code splitting via react-router's `lazy` (data router). The public site needs no
// sign-in; the `/console` subtree requires a token. /login and /callback stay at the root because
// the OIDC client is registered with `${origin}/callback` as its redirect URI.
const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({
  Component: (await load()).default,
})

export const router = createBrowserRouter([
  { path: '/login', lazy: page(() => import('@/routes/login')) },
  { path: '/callback', lazy: page(() => import('@/routes/callback')) },
  {
    path: '/console',
    loader: requireAuthLoader,
    element: <ConsoleLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: page(() => import('@/routes/console/overview')) },
      { path: 'facts', lazy: page(() => import('@/routes/console/facts')) },
      { path: 'entries/:lemma?', lazy: page(() => import('@/routes/console/entries')) },
      { path: 'feedback', lazy: page(() => import('@/routes/console/feedback')) },
      { path: 'agents', lazy: page(() => import('@/routes/console/agents')) },
      { path: 'about', lazy: page(() => import('@/routes/console/about')) },
      { path: '*', lazy: page(() => import('@/routes/not-found')) },
    ],
  },
  {
    path: '/',
    element: <PublicLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: page(() => import('@/routes/home')) },
      { path: 'words/:lemma', lazy: page(() => import('@/routes/word')) },
      { path: 'browse', lazy: page(() => import('@/routes/browse')) },
      { path: 'developers', lazy: page(() => import('@/routes/developers')) },
      { path: '*', lazy: page(() => import('@/routes/not-found')) },
    ],
  },
])
