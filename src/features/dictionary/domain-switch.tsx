import type { RelationDomain } from '@shared/facts'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import { cn } from '@/shared/lib/cn'

const LAYERS: Array<RelationDomain | null> = [null, 'biology', 'medicine']

/** Picks the relation layer: everyday categories alone, or with a specialist taxonomy beside them. */
export function DomainSwitch({ domain, className }: { domain: RelationDomain | undefined; className?: string }) {
  const { t } = useTranslation()
  const location = useLocation()
  const hrefOf = (layer: RelationDomain | null) => {
    const params = new URLSearchParams(location.search)
    if (layer) params.set('domain', layer)
    else params.delete('domain')
    const search = params.toString()
    return `${location.pathname}${search ? `?${search}` : ''}`
  }
  return (
    <nav aria-label={t('entry.domain')} className={cn('flex flex-col gap-1.5', className)}>
      <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{t('entry.domain')}</span>
      <div className="inline-flex w-fit rounded-lg border bg-muted p-0.5">
        {LAYERS.map((layer) => {
          const active = (domain ?? null) === layer
          return (
            <Link
              key={layer ?? 'everyday'}
              to={hrefOf(layer)}
              replace
              preventScrollReset
              aria-current={active ? 'true' : undefined}
              className={cn(
                'rounded-md px-2.5 py-1 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground',
                active && 'bg-background text-foreground shadow-sm',
              )}
            >
              {t(`entry.domains.${layer ?? 'everyday'}`)}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
