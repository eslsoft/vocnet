import { createBrowserRouter } from 'react-router'
import { Layout } from '@/app/layout'
import { requireAuthLoader } from '@/features/auth'
import { RouteError } from '@/routes/error'

// Route-level code splitting via react-router's `lazy` (data router). The `/`
// subtree requires a token; /login and /callback are public.
export const router = createBrowserRouter([
  { path: '/login', lazy: async () => ({ Component: (await import('@/routes/login')).default }) },
  { path: '/callback', lazy: async () => ({ Component: (await import('@/routes/callback')).default }) },
  {
    path: '/',
    loader: requireAuthLoader,
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: async () => ({ Component: (await import('@/routes/overview')).default }) },
      { path: 'facts', lazy: async () => ({ Component: (await import('@/routes/facts')).default }) },
      { path: 'entries/:lemma?', lazy: async () => ({ Component: (await import('@/routes/entries')).default }) },
      { path: 'feedback', lazy: async () => ({ Component: (await import('@/routes/feedback')).default }) },
      { path: 'agents', lazy: async () => ({ Component: (await import('@/routes/agents')).default }) },
      { path: 'about', lazy: async () => ({ Component: (await import('@/routes/about')).default }) },
      { path: '*', lazy: async () => ({ Component: (await import('@/routes/not-found')).default }) },
    ],
  },
])
