import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useEntry } from '@/features/dictionary'
import { languages } from '@/shared/i18n'
import { cn } from '@/shared/lib/cn'
import { CodeBlock } from '@/shared/ui/code-block'
import { GUIDE, type GuideText } from './content'
import { ENDPOINTS, type Endpoint } from './endpoints'
import { TryIt } from './try-it'

const SECTION_IDS = [
  'quickstart',
  'auth',
  'limits',
  'language',
  'domain',
  'pagination',
  'caching',
  'errors',
  'feedback',
  'endpoints',
  'reference',
] as const

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-24 flex-col gap-4">
      <h2 id={`${id}-title`} className="font-semibold text-2xl tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  )
}

const Prose = ({ children }: { children: ReactNode }) => (
  <p className="max-w-prose text-muted-foreground leading-relaxed">{children}</p>
)

function Code({ code, language = 'shell' }: { code: string; language?: 'shell' | 'json' | 'text' }) {
  const { t } = useTranslation()
  return <CodeBlock language={language} code={code} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} />
}

function EndpointDoc({ endpoint, text, senseId }: { endpoint: Endpoint; text: GuideText; senseId: string }) {
  const doc = text.endpoints[endpoint.id]
  const origin = window.location.origin
  return (
    <article
      id={`endpoint-${endpoint.id}`}
      aria-labelledby={`endpoint-${endpoint.id}-title`}
      className="flex scroll-mt-24 flex-col gap-3 border-t pt-8"
    >
      <header className="flex flex-col gap-2">
        <h3 id={`endpoint-${endpoint.id}-title`} className="font-semibold text-lg">
          {doc.title}
        </h3>
        <p className="flex items-center gap-2 font-mono text-sm">
          <span
            className={cn(
              'rounded px-1.5 py-0.5 font-semibold text-xs',
              endpoint.method === 'GET'
                ? 'bg-accent text-accent-foreground'
                : 'bg-amber-50 text-amber-900 dark:bg-amber-400/10 dark:text-amber-300',
            )}
          >
            {endpoint.method}
          </span>
          {endpoint.path}
        </p>
      </header>
      <Prose>{doc.body}</Prose>
      {endpoint.tryable ? (
        <TryIt endpoint={endpoint} senseId={senseId} text={text.tryIt} />
      ) : (
        <div className="flex flex-col gap-2">
          <Code
            code={`curl -s -X POST '${origin}${endpoint.path}' \\\n  -H 'content-type: application/json' \\\n  -d '{"target_type": "sense", "target_id": "${senseId}", "message": "The second example is not natural English."}'`}
          />
          <p className="text-muted-foreground text-xs">{text.tryIt.readOnly}</p>
        </div>
      )}
    </article>
  )
}

function GuideLanguage() {
  const { i18n } = useTranslation()
  return (
    <fieldset className="inline-flex w-fit rounded-lg border bg-muted p-0.5">
      <legend className="sr-only">Language</legend>
      {[...languages].reverse().map((language) => (
        <button
          key={language.value}
          type="button"
          lang={language.value}
          aria-pressed={i18n.language === language.value}
          onClick={() => void i18n.changeLanguage(language.value)}
          className={cn(
            'rounded-md px-2.5 py-1 font-medium text-muted-foreground text-xs',
            i18n.language === language.value && 'bg-background text-foreground shadow-sm',
          )}
        >
          {language.label}
        </button>
      ))}
    </fieldset>
  )
}

/** The developer guide: how to call the public API, with every endpoint runnable from the page. */
export function DeveloperGuide() {
  const { t, i18n } = useTranslation()
  const text = GUIDE[i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US']
  const { sections } = text
  const origin = window.location.origin
  // A real sense id for the examples that need one; the guide reads it like any client would.
  const animal = useEntry('animal', undefined)
  const senseId = animal.data?.entry.meanings[0]?.senses[0]?.id ?? ''
  const toc: Array<{ id: string; title: string; children?: Array<{ id: string; title: string }> }> = SECTION_IDS.map(
    (id) => ({
      id,
      title: sections[id].title,
      children:
        id === 'endpoints'
          ? ENDPOINTS.map((endpoint) => ({ id: `endpoint-${endpoint.id}`, title: text.endpoints[endpoint.id].title }))
          : undefined,
    }),
  )
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <title>{`${text.title} · ${t('appName')}`}</title>
      <aside className="hidden lg:block">
        <nav
          aria-label={text.toc}
          className="sticky top-20 flex max-h-[calc(100dvh-6rem)] flex-col gap-2 overflow-auto pr-2"
        >
          <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{text.toc}</span>
          <ul className="flex flex-col gap-0.5 text-sm">
            {toc.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className="block rounded-md px-2 py-1 hover:bg-muted">
                  {item.title}
                </a>
                {item.children ? (
                  <ul className="ml-2 border-l pl-2">
                    {item.children.map((child) => (
                      <li key={child.id}>
                        <a
                          href={`#${child.id}`}
                          className="block rounded-md px-2 py-0.5 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
                        >
                          {child.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col gap-12">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">{text.title}</h1>
            <GuideLanguage />
          </div>
          <p className="max-w-prose text-lg text-muted-foreground leading-relaxed">{text.lead}</p>
        </header>

        <Section id="quickstart" title={sections.quickstart.title}>
          <dl className="flex flex-wrap items-baseline gap-2">
            <dt className="text-muted-foreground text-sm">{sections.quickstart.baseUrl}</dt>
            <dd className="rounded-md bg-muted px-2 py-0.5 font-mono text-sm">{origin}/v1</dd>
          </dl>
          <Prose>{sections.quickstart.body}</Prose>
          <Code code={`curl -s '${origin}/v1/entries/animal?lang=zh'`} />
        </Section>

        <Section id="auth" title={sections.auth.title}>
          <Prose>{sections.auth.body}</Prose>
        </Section>

        <Section id="limits" title={sections.limits.title}>
          <Prose>{sections.limits.body}</Prose>
          <Code language="text" code={'HTTP/1.1 429 Too Many Requests\nRetry-After: 60'} />
        </Section>

        <Section id="language" title={sections.language.title}>
          <Prose>{sections.language.body}</Prose>
          <Code
            code={`curl -s '${origin}/v1/search?q=银行&lang=zh'\ncurl -s -H 'Accept-Language: zh-CN' '${origin}/v1/entries/bank'`}
          />
          <Prose>{sections.language.note}</Prose>
        </Section>

        <Section id="domain" title={sections.domain.title}>
          <Prose>{sections.domain.body}</Prose>
          <Code
            code={`curl -s '${origin}/v1/entries/dog?domain=biology' | jq '.meanings[0].senses[0].relations.broader'`}
          />
        </Section>

        <Section id="pagination" title={sections.pagination.title}>
          <Prose>{sections.pagination.body}</Prose>
          <Code
            code={`curl -s '${origin}/v1/entries?level=A1&limit=50'\n# → { "items": [...], "next_cursor": "eyJ..." }\ncurl -s '${origin}/v1/entries?level=A1&limit=50&cursor=eyJ...'`}
          />
        </Section>

        <Section id="caching" title={sections.caching.title}>
          <Prose>{sections.caching.body}</Prose>
          <ul className="flex max-w-prose list-disc flex-col gap-2 pl-5 text-muted-foreground leading-relaxed">
            <li>{sections.caching.documents}</li>
            <li>{sections.caching.lists}</li>
          </ul>
          <Code
            code={`curl -si '${origin}/v1/entries/animal' -H 'If-None-Match: "<etag>"'\n# → HTTP/1.1 304 Not Modified`}
          />
        </Section>

        <Section id="errors" title={sections.errors.title}>
          <Prose>{sections.errors.body}</Prose>
          <Code
            language="json"
            code={'{\n  "error": {\n    "code": "not_found",\n    "message": "No entry for \\"animalz\\"."\n  }\n}'}
          />
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-muted-foreground text-xs">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    code
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    HTTP
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {sections.errors.meaning}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(
                  [
                    ['invalid_request', 400],
                    ['invalid_cursor', 400],
                    ['not_found', 404],
                    ['rate_limited', 429],
                    ['internal_error', 500],
                  ] as const
                ).map(([code, status]) => (
                  <tr key={code}>
                    <td className="px-3 py-2 font-mono text-xs">{code}</td>
                    <td className="px-3 py-2 font-mono text-xs">{status}</td>
                    <td className="px-3 py-2 text-muted-foreground">{sections.errors.codes[code]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="feedback" title={sections.feedback.title}>
          <Prose>{sections.feedback.body}</Prose>
        </Section>

        <Section id="endpoints" title={sections.endpoints.title}>
          <Prose>{sections.endpoints.body}</Prose>
          {ENDPOINTS.map((endpoint) => (
            <EndpointDoc key={endpoint.id} endpoint={endpoint} text={text} senseId={senseId} />
          ))}
        </Section>

        <Section id="reference" title={sections.reference.title}>
          <Prose>{sections.reference.body}</Prose>
          <ul className="flex flex-col gap-2">
            <li>
              <a className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline" href="/docs">
                {sections.reference.scalar}
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
            </li>
            <li>
              <a
                className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                href="/openapi.json"
              >
                {sections.reference.openapi}
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
            </li>
          </ul>
        </Section>
      </div>
    </div>
  )
}
