import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
        <p className="max-w-2xl text-muted-foreground text-sm">{subtitle}</p>
      </div>
      {actions}
    </div>
  )
}
