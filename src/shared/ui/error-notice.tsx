import { cn } from '@/shared/lib/cn'

/** Shows a failed operation's message where the user acted. */
export function ErrorNotice({ error, className }: { error: Error | null; className?: string }) {
  if (!error) return null
  return (
    <p role="alert" className={cn('rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm', className)}>
      {error.message}
    </p>
  )
}
