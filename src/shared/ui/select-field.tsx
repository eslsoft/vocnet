import type * as React from 'react'
import { cn } from '@/shared/lib/cn'

/** A labelled native select: accessible and keyboard friendly without a popup primitive. */
export function SelectField({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<'select'> & { label: string }) {
  return (
    <label className={cn('flex flex-col gap-1 text-muted-foreground text-xs', className)}>
      {label}
      <select
        className="h-8 rounded-lg border border-input bg-background px-2 text-foreground text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        {...props}
      >
        {children}
      </select>
    </label>
  )
}
