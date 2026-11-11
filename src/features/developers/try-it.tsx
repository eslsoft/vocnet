import { useMutation } from '@tanstack/react-query'
import { CircleCheck, CircleX, Play } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { curlCommand } from '@/features/dictionary'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/button'
import { CodeBlock } from '@/shared/ui/code-block'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { sendRequest, type TryResult } from './api'
import type { GuideText } from './content'
import { apiErrorSchema, type Endpoint, requestPath } from './endpoints'

const initialValues = (endpoint: Endpoint, senseId: string) =>
  Object.fromEntries(endpoint.params.map((param) => [param.name, param.example.replace('{sense}', senseId)]))

const nonEmpty = (values: Record<string, string>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''))

/** Whether the body is what the shared contract says this status carries. */
function contractCheck(endpoint: Endpoint, result: TryResult) {
  const schema = result.status >= 200 && result.status < 300 ? endpoint.schema : apiErrorSchema
  return schema.safeParse(result.json)
}

function Result({ endpoint, result, text }: { endpoint: Endpoint; result: TryResult; text: GuideText['tryIt'] }) {
  const { t } = useTranslation()
  const check = result.json === undefined ? null : contractCheck(endpoint, result)
  const tone =
    result.status < 300
      ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300'
      : result.status < 500
        ? 'bg-amber-50 text-amber-900 dark:bg-amber-400/10 dark:text-amber-300'
        : 'bg-red-50 text-red-800 dark:bg-red-400/10 dark:text-red-300'
  return (
    <section aria-label={text.body} className="flex flex-col gap-3" aria-live="polite">
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">{text.status}</dt>
          <dd className={cn('rounded px-1.5 py-0.5 font-mono font-semibold text-xs', tone)}>
            {result.status} {result.statusText}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">{text.time}</dt>
          <dd className="font-mono text-xs">{result.durationMs} ms</dd>
        </div>
        {check ? (
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Contract</dt>
            <dd
              className={cn(
                'flex items-center gap-1 text-xs',
                check.success ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive',
              )}
            >
              {check.success ? (
                <CircleCheck aria-hidden="true" className="size-4" />
              ) : (
                <CircleX aria-hidden="true" className="size-4" />
              )}
              {check.success ? text.matches : `${text.mismatch}: ${check.error.issues.length}`}
            </dd>
          </div>
        ) : null}
      </dl>
      {result.headers.length > 0 ? (
        <dl aria-label={text.headers} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
          {result.headers.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-muted-foreground">{name}</dt>
              <dd className="break-all">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {result.json === undefined ? (
        <p className="text-muted-foreground text-sm">{text.notJson}</p>
      ) : (
        <CodeBlock
          language="json"
          caption={text.body}
          code={JSON.stringify(result.json, null, 2)}
          copyLabel={t('common.copy')}
          copiedLabel={t('common.copied')}
        />
      )}
    </section>
  )
}

/** Edit an endpoint's parameters, call the real API from the browser, and read what came back. */
export function TryIt({ endpoint, senseId, text }: { endpoint: Endpoint; senseId: string; text: GuideText['tryIt'] }) {
  const { t } = useTranslation()
  const formId = useId()
  const [values, setValues] = useState(() => initialValues(endpoint, senseId))
  // The sample sense id arrives with the guide's own read; fill it in where the reader has not typed.
  useEffect(() => {
    if (!senseId) return
    setValues((current) => ({ ...initialValues(endpoint, senseId), ...nonEmpty(current) }))
  }, [endpoint, senseId])
  const path = requestPath(endpoint, values)
  const send = useMutation({ mutationFn: (target: string) => sendRequest(endpoint.method, target) })
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <h4 className="font-semibold text-sm">{text.title}</h4>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          send.mutate(path)
        }}
      >
        {endpoint.params.length > 0 ? (
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">{text.params}</legend>
            {endpoint.params.map((param) => (
              <label key={param.name} className="flex flex-col gap-1 text-xs">
                <span className="font-mono text-muted-foreground">
                  {param.name}
                  {param.in === 'path' ? <span className="text-highlight"> *</span> : null}
                </span>
                <input
                  id={`${formId}-${param.name}`}
                  value={values[param.name]}
                  required={param.in === 'path'}
                  onChange={(event) => setValues((current) => ({ ...current, [param.name]: event.target.value }))}
                  className="h-8 rounded-md border border-input bg-background px-2 font-mono text-foreground text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                />
              </label>
            ))}
          </fieldset>
        ) : null}
        <CodeBlock
          language="shell"
          code={curlCommand(path)}
          copyLabel={t('common.copy')}
          copiedLabel={t('common.copied')}
        />
        <Button type="submit" className="self-start" disabled={send.isPending}>
          <Play aria-hidden="true" />
          {send.isPending ? text.sending : text.send}
        </Button>
      </form>
      <ErrorNotice error={send.error} />
      {send.data ? <Result endpoint={endpoint} result={send.data} text={text} /> : null}
    </div>
  )
}
