import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

/** One headline number with its label, an optional badge beside the label, and a line of context below. */
export function StatCard({
  label,
  value,
  badge,
  children,
  className,
}: {
  label: string
  value: ReactNode
  badge?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section
      aria-label={label}
      data-slot="stat-card"
      className={cn(
        'flex h-full flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground shadow-xs',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-muted-foreground text-sm">{label}</h2>
        {badge}
      </div>
      <p className="font-semibold text-3xl tabular-nums tracking-tight">{value}</p>
      {children ? <div className="flex flex-col gap-2 text-muted-foreground text-xs">{children}</div> : null}
    </section>
  )
}
