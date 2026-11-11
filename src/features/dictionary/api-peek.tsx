import { Braces } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '@/shared/ui/button'
import { CodeBlock } from '@/shared/ui/code-block'
import { jqPath, sliceAt } from './entry-format'

/** The read behind a block and the slice of its JSON the block shows, as a request anyone can repeat. */
export function curlCommand(path: string, slice: ReadonlyArray<string | number> = [], pick?: string[]): string {
  const request = `curl -s '${window.location.origin}${path}'`
  const filter = jqFilter(slice, pick)
  return filter === '.' ? request : `${request} | jq '${filter}'`
}

/** The jq filter for a slice, optionally narrowed to some of its fields. */
function jqFilter(slice: ReadonlyArray<string | number>, pick?: string[]): string {
  const path = jqPath(slice)
  if (!pick) return path
  const fields = `{${pick.join(', ')}}`
  return path === '.' ? fields : `${path} | ${fields}`
}

function sliceOf(payload: unknown, slice: ReadonlyArray<string | number>, pick?: string[]): unknown {
  const value = sliceAt(payload, slice) as Record<string, unknown>
  return pick ? Object.fromEntries(pick.map((field) => [field, value[field]])) : value
}

export interface ApiSource {
  path: string
  payload: unknown
  slice: ReadonlyArray<string | number>
  pick?: string[]
}

/**
 * A discreet toggle that opens the exact request and the JSON slice a block of the page came from.
 * The block places the toggle in its header and the panel at its full width.
 */
export function useApiPeek(source: ApiSource): { toggle: ReactNode; panel: ReactNode } {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return {
    toggle: (
      <Button
        variant="ghost"
        size="xs"
        className="shrink-0 text-muted-foreground"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Braces aria-hidden="true" />
        {t('api.toggle')}
      </Button>
    ),
    panel: open ? <ApiPanel id={panelId} {...source} /> : null,
  }
}

function ApiPanel({ id, path, payload, slice, pick }: ApiSource & { id: string }) {
  const { t } = useTranslation()
  return (
    <section
      id={id}
      aria-label={t('api.panel')}
      className="flex w-full min-w-0 flex-col gap-2 rounded-lg border bg-background p-3 text-left shadow-sm"
    >
      <CodeBlock
        caption={t('api.request')}
        language="shell"
        code={curlCommand(path, slice, pick)}
        copyLabel={t('common.copy')}
        copiedLabel={t('common.copied')}
      />
      <CodeBlock
        caption={t('api.response', { path: jqFilter(slice, pick) })}
        language="json"
        code={JSON.stringify(sliceOf(payload, slice, pick), null, 2)}
        copyLabel={t('common.copy')}
        copiedLabel={t('common.copied')}
      />
      <Link className="self-start text-primary text-xs underline-offset-4 hover:underline" to="/developers">
        {t('api.guide')}
      </Link>
    </section>
  )
}
