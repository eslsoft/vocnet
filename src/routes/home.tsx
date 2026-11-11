import { ArrowRight, Braces, GitFork, Layers, Network, Puzzle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { SearchBox } from '@/features/dictionary'
import { cn } from '@/shared/lib/cn'
import { buttonVariants } from '@/shared/ui/button'
import { CodeBlock } from '@/shared/ui/code-block'

interface Showcase {
  key: 'kinds' | 'parts' | 'opposites' | 'layers'
  to: string
  icon: typeof Network
  from: string
  words: string[]
  connector: string
}

const SHOWCASES: Showcase[] = [
  {
    key: 'kinds',
    to: '/browse?root=animal',
    icon: Network,
    from: 'animal',
    words: ['bird', 'fish', 'dog', 'cat', 'horse'],
    connector: '→',
  },
  {
    key: 'parts',
    to: '/words/bird',
    icon: Puzzle,
    from: 'bird',
    words: ['feather', 'beak', 'wing', 'tail', 'claw'],
    connector: '⊃',
  },
  { key: 'opposites', to: '/words/hot', icon: GitFork, from: 'hot', words: ['cold'], connector: '↔' },
  {
    key: 'layers',
    to: '/words/dog?domain=biology',
    icon: Layers,
    from: 'dog',
    words: ['pet', 'animal', 'canine', 'mammal'],
    connector: '⊂',
  },
]

function ShowcaseCard({ showcase }: { showcase: Showcase }) {
  const { t } = useTranslation()
  const Icon = showcase.icon
  return (
    <li>
      <Link
        to={showcase.to}
        className="group flex h-full flex-col gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-primary/50"
      >
        <span className="flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          <Icon aria-hidden="true" className="size-4 text-primary" />
          {t(`home.showcase.${showcase.key}.label`)}
        </span>
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
          <span className="font-semibold font-serif text-2xl">{showcase.from}</span>
          <span aria-hidden="true" className="text-muted-foreground">
            {showcase.connector}
          </span>
          {showcase.words.map((word) => (
            <span key={word} className="rounded-md bg-muted px-2 py-0.5 text-sm">
              {word}
            </span>
          ))}
        </span>
        <span className="text-muted-foreground text-sm leading-relaxed">{t(`home.showcase.${showcase.key}.body`)}</span>
        <span className="mt-auto inline-flex items-center gap-1 font-medium text-primary text-sm">
          {t(`home.showcase.${showcase.key}.cta`)}
          <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </li>
  )
}

function Feature({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">{children}</p>
    </div>
  )
}

export default function HomePage() {
  const { t } = useTranslation()
  const origin = window.location.origin
  return (
    <>
      <title>{`${t('appName')} · ${t('home.title')}`}</title>
      <section className="border-b bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-14 sm:py-20">
          <div className="flex max-w-3xl flex-col gap-4">
            <p className="font-medium text-primary text-sm">{t('home.eyebrow')}</p>
            <h1 className="text-balance font-semibold text-4xl tracking-tight sm:text-5xl">{t('home.title')}</h1>
            <p className="max-w-2xl text-lg text-muted-foreground leading-relaxed">{t('site.tagline')}</p>
          </div>
          <SearchBox size="lg" className="max-w-2xl" />
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/browse" className={buttonVariants({ size: 'lg' })}>
              {t('home.browse')}
            </Link>
            <Link to="/developers" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              <Braces aria-hidden="true" />
              {t('home.developers')}
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="showcase-title" className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-14">
        <div className="flex flex-col gap-2">
          <h2 id="showcase-title" className="font-semibold text-2xl tracking-tight">
            {t('home.showcaseTitle')}
          </h2>
          <p className="max-w-2xl text-muted-foreground">{t('home.showcaseBody')}</p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SHOWCASES.map((showcase) => (
            <ShowcaseCard key={showcase.key} showcase={showcase} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="api-title" className="border-t">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 lg:grid-cols-2 lg:items-center">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 id="api-title" className="font-semibold text-2xl tracking-tight">
                {t('home.apiTitle')}
              </h2>
              <p className="text-muted-foreground">{t('home.apiBody')}</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Feature title={t('home.features.open.title')}>{t('home.features.open.body')}</Feature>
              <Feature title={t('home.features.reviewed.title')}>{t('home.features.reviewed.body')}</Feature>
              <Feature title={t('home.features.network.title')}>{t('home.features.network.body')}</Feature>
              <Feature title={t('home.features.bilingual.title')}>{t('home.features.bilingual.body')}</Feature>
            </div>
            <Link to="/developers" className={cn(buttonVariants({ variant: 'outline' }), 'self-start')}>
              {t('home.readGuide')}
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
          <CodeBlock
            language="shell"
            caption={t('home.apiCaption')}
            copyLabel={t('common.copy')}
            copiedLabel={t('common.copied')}
            code={[
              `curl -s '${origin}/v1/search?q=bank&lang=zh'`,
              `curl -s '${origin}/v1/entries/bird?lang=zh' | jq '.meanings[0].senses[0].relations.parts'`,
              `curl -s '${origin}/v1/senses/{id}/members?domain=biology'`,
            ].join('\n')}
          />
        </div>
      </section>
    </>
  )
}
