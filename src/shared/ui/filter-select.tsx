import { cn } from '@/shared/lib/cn'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/shared/ui/select'

export interface FilterOption {
  value: string
  label: string
}

const ALL = '__all__'

/**
 * A compact select for list filters that reads "Label: Value". `null` is the unfiltered choice,
 * shown as `allLabel`; without one, a value is always chosen.
 */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
  allLabel,
  className,
}: {
  label: string
  value: string | null
  options: FilterOption[]
  onChange: (value: string | null) => void
  allLabel?: string
  className?: string
}) {
  const items = allLabel === undefined ? options : [{ value: ALL, label: allLabel }, ...options]
  const current = items.find((item) => item.value === (value ?? ALL))
  return (
    <Select
      items={items}
      value={value ?? ALL}
      onValueChange={(next) => onChange(next === ALL || next === null ? null : String(next))}
    >
      <SelectTrigger aria-label={label} className={cn('h-8 min-w-32 bg-background', className)}>
        <span className="truncate">
          <span className="text-muted-foreground">{label}: </span>
          {current?.label}
        </span>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
