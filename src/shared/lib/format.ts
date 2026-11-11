export function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

/** A short timestamp for timelines: month, day, and time. */
export function formatStamp(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  )
}

export function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date)
}

export function formatPercent(value: number, locale: string, digits = 0): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function formatNumber(value: number, locale: string, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0, ...options }).format(value)
}

/** A signed count, so a change always shows its direction: +30, −390. */
export function formatSigned(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(value)
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

/** "3 min ago", "in 12 minutes", "yesterday": the largest whole unit, seconds read as now. */
export function formatRelative(iso: string, locale: string, now: number = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit)
  }
  return format.format(0, 'second')
}

/** A compact duration: 45s, 4m 10s, 6h 40m, 1d 4h. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds)
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const rest = seconds % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  if (minutes > 0) return rest > 0 ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${minutes}m`
  return `${rest}s`
}
