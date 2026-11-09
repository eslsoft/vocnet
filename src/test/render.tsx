import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import '@/shared/i18n'
import { createQueryClient } from '@/shared/query/client'

/** Renders a page element at a URL with a fresh production query client; the router exposes the current location. */
export function renderAt(url: string, routes: Array<{ path: string; element: ReactNode }>) {
  const router = createMemoryRouter([...routes, { path: '*', element: <p>elsewhere</p> }], { initialEntries: [url] })
  const queryClient = createQueryClient()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  const location = () => `${router.state.location.pathname}${router.state.location.search}`
  return { ...view, router, location }
}
