import { Component, type ReactNode } from 'react'
import { reportBrowserError } from '@/shared/observability/errors'

// Top-level boundary for render errors outside the router (the router has its own
// errorElement). Class component because React has no hook equivalent.
export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    reportBrowserError(error, 'react.error-boundary')
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="grid min-h-dvh place-items-center text-muted-foreground text-sm">Something went wrong.</div>
      )
    }
    return this.props.children
  }
}
