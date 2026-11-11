import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { CopyButton } from '@/shared/ui/copy-button'

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

/** Colors the strings, keys, numbers, and literals of pretty-printed JSON. */
function highlightJson(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(JSON_TOKEN)) {
    const at = match.index ?? 0
    if (at > last) nodes.push(text.slice(last, at))
    const [whole, string, colon] = match
    const tone = string ? (colon ? 'text-foreground' : 'text-primary') : 'text-highlight'
    nodes.push(
      <span key={at} className={tone}>
        {string ?? whole}
      </span>,
    )
    if (colon) nodes.push(colon)
    last = at + whole.length
  }
  nodes.push(text.slice(last))
  return nodes
}

/** A block of code or JSON with a copy button; long blocks scroll inside. */
export function CodeBlock({
  code,
  language,
  copyLabel,
  copiedLabel,
  caption,
  className,
}: {
  code: string
  language: 'json' | 'shell' | 'text'
  copyLabel: string
  copiedLabel: string
  caption?: string
  className?: string
}) {
  return (
    <figure className={cn('group relative min-w-0 overflow-hidden rounded-lg border bg-surface', className)}>
      {caption ? (
        <figcaption className="border-b px-3 py-1.5 font-medium text-muted-foreground text-xs">{caption}</figcaption>
      ) : null}
      <CopyButton
        text={code}
        label={copyLabel}
        copiedLabel={copiedLabel}
        className="absolute top-1 right-1 bg-surface"
      />
      <pre
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard.
        tabIndex={0}
        className="max-h-96 overflow-auto p-3 pr-10 font-mono text-[0.8125rem] text-muted-foreground leading-relaxed"
      >
        <code>{language === 'json' ? highlightJson(code) : code}</code>
      </pre>
    </figure>
  )
}
