import { useRouteError } from 'react-router'

export function RouteError() {
  const error = useRouteError()
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="font-heading text-xl font-semibold">Error</h1>
      <p className="text-muted-foreground text-sm">{message}</p>
    </div>
  )
}
