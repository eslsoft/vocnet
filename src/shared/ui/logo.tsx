import { cn } from '@/shared/lib/cn'

/** The Vocnet mark: three linked word nodes forming a V, the relation network the dictionary is built on. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-7 shrink-0', className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M9 10 16 23 23 10"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary-foreground/70"
      />
      <path d="M9 10h14" fill="none" strokeWidth="1.6" strokeLinecap="round" className="stroke-primary-foreground/35" />
      <circle cx="9" cy="10" r="3.1" className="fill-primary-foreground" />
      <circle cx="23" cy="10" r="3.1" className="fill-primary-foreground" />
      <circle cx="16" cy="23" r="3.4" className="fill-primary-foreground" />
    </svg>
  )
}

/** The mark with the wordmark beside it. */
export function Logo({ className, suffix }: { className?: string; suffix?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="font-semibold text-[1.0625rem] tracking-tight">Vocnet</span>
      {suffix ? (
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-muted-foreground text-xs">{suffix}</span>
      ) : null}
    </span>
  )
}
