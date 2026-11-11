import { relationDomainSchema } from '@shared/facts'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { cn } from '@/shared/lib/cn'
import { CategoryExplorer } from './category-explorer'
import { TopicBrowser } from './topic-browser'

type View = 'categories' | 'topics'

/** Browse the dictionary by category (kinds of a word) or by topic. A ?topic= link opens the topics view. */
export function BrowsePage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const view: View = params.get('view') === 'topics' || params.has('topic') ? 'topics' : 'categories'
  const domain = relationDomainSchema.safeParse(params.get('domain'))
  const tabs: Array<{ view: View; href: string }> = [
    { view: 'categories', href: '/browse' },
    { view: 'topics', href: '/browse?view=topics' },
  ]
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10">
      <title>{`${t('browse.title')} · ${t('appName')}`}</title>
      <header className="flex flex-col gap-2">
        <h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">{t('browse.title')}</h1>
        <p className="max-w-2xl text-muted-foreground">{t('browse.subtitle')}</p>
      </header>
      <nav aria-label={t('browse.views')} className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <Link
            key={tab.view}
            to={tab.href}
            aria-current={view === tab.view ? 'page' : undefined}
            className={cn(
              '-mb-px border-transparent border-b-2 px-3 py-2 font-medium text-muted-foreground text-sm hover:text-foreground',
              view === tab.view && 'border-primary text-foreground',
            )}
          >
            {t(`browse.${tab.view}`)}
          </Link>
        ))}
      </nav>
      {view === 'topics' ? <TopicBrowser /> : <CategoryExplorer domain={domain.success ? domain.data : undefined} />}
    </div>
  )
}
