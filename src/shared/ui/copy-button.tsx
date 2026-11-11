import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/button'

const RESET_MS = 1600

/** Copies text to the clipboard and says so for a moment. */
export function CopyButton({
  text,
  label,
  copiedLabel,
  className,
}: {
  text: string
  label: string
  copiedLabel: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), RESET_MS)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn('text-muted-foreground', className)}
      aria-label={copied ? copiedLabel : label}
      title={copied ? copiedLabel : label}
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </Button>
  )
}
