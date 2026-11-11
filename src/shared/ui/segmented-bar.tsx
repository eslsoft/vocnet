import { cn } from '@/shared/lib/cn'

export interface BarSegment {
  value: number
  className: string
}

/** A thin bar split into adjacent segments, each a share of `total`; the label reads the whole bar. */
export function SegmentedBar({
  segments,
  total,
  label,
  className,
}: {
  segments: BarSegment[]
  total: number
  label: string
  className?: string
}) {
  return (
    <div
      role="img"
      aria-label={label}
      data-slot="segmented-bar"
      className={cn('flex h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      {segments.map((segment, index) =>
        segment.value > 0 && total > 0 ? (
          <span
            // Segments are positional; their order never changes.
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed positional segments
            key={index}
            className={cn('h-full', segment.className)}
            style={{ width: `${Math.min(100, (segment.value / total) * 100)}%` }}
          />
        ) : null,
      )}
    </div>
  )
}
