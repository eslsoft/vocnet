import type { TopicTree } from '@shared/topics'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { CefrBadge, wordPath } from '@/features/dictionary'
import { cn } from '@/shared/lib/cn'
import { useSearchParamState } from '@/shared/lib/search-params'
import { Button } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Skeleton } from '@/shared/ui/skeleton'
import { useTopicSenses, useTopicTree } from './hooks'

type Named = { name: { en: string; zh: string } }

function useTopicName() {
  const { i18n } = useTranslation()
  return (topic: Named) => (i18n.language.startsWith('zh') ? topic.name.zh : topic.name.en)
}

function TopicSenses({ topic, tree }: { topic: string; tree: TopicTree }) {
  const { t } = useTranslation()
  const name = useTopicName()
  const senses = useTopicSenses(topic)
  const node = tree.categories.flatMap((category) => [category, ...category.topics]).find((item) => item.id === topic)
  const items = senses.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <section aria-labelledby="topic-title" className="flex min-w-0 flex-col gap-4">
      <h2 id="topic-title" className="font-semibold text-2xl tracking-tight">
        {node ? name(node) : topic}
      </h2>
      <ErrorNotice error={senses.error} />
      {senses.isPending ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
            <Skeleton key={index} className="h-16" />
          ))}
        </div>
      ) : null}
      {senses.data && items.length === 0 ? <p className="text-muted-foreground">{t('browse.emptyTopic')}</p> : null}
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((sense) => (
          <li key={sense.sense_id}>
            <Link
              to={wordPath(sense.lemma, sense.sense_id)}
              className="flex h-full flex-col gap-1 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/50"
            >
              <span className="flex items-baseline gap-2">
                <span className="font-semibold font-serif text-lg">{sense.lemma}</span>
                <span className="text-muted-foreground text-xs italic">{t(`pos.${sense.pos}`)}</span>
                {sense.cefr ? <CefrBadge level={sense.cefr} className="self-center" /> : null}
                {sense.translation ? (
                  <span lang="zh-CN" className="ml-auto text-muted-foreground text-sm">
                    {sense.translation}
                  </span>
                ) : null}
              </span>
              <span className="line-clamp-2 text-muted-foreground text-sm">{sense.gloss}</span>
            </Link>
          </li>
        ))}
      </ul>
      {senses.hasNextPage ? (
        <Button
          variant="outline"
          className="self-start"
          disabled={senses.isFetchingNextPage}
          onClick={() => void senses.fetchNextPage()}
        >
          {t('common.loadMore')}
        </Button>
      ) : null}
    </section>
  )
}

/** The topic taxonomy: categories group leaf topics, and a topic lists the senses tagged with it. */
export function TopicBrowser() {
  const { t } = useTranslation()
  const name = useTopicName()
  const tree = useTopicTree()
  const [params, setParam] = useSearchParamState()
  const topic = params.get('topic')
  if (tree.error) return <ErrorNotice error={tree.error} />
  if (!tree.data) return <Skeleton className="h-96" />
  return (
    <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <nav
        aria-label={t('browse.topics')}
        className="flex flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-auto lg:pr-2"
      >
        {tree.data.categories.map((category) => (
          <div key={category.id} className="flex flex-col gap-1">
            <button
              type="button"
              aria-current={topic === category.id ? 'true' : undefined}
              onClick={() => setParam('topic', category.id)}
              className={cn(
                'rounded-md px-2 py-1 text-left font-semibold text-sm hover:bg-muted',
                topic === category.id && 'bg-accent text-accent-foreground',
              )}
            >
              {name(category)}
            </button>
            <ul className="flex flex-wrap gap-1 lg:flex-col lg:gap-0">
              {category.topics.map((leaf) => (
                <li key={leaf.id}>
                  <button
                    type="button"
                    aria-current={topic === leaf.id ? 'true' : undefined}
                    onClick={() => setParam('topic', leaf.id)}
                    className={cn(
                      'w-full rounded-md px-2 py-1 text-left text-muted-foreground text-sm hover:bg-muted hover:text-foreground',
                      topic === leaf.id && 'bg-accent font-medium text-accent-foreground',
                    )}
                  >
                    {name(leaf)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {topic ? (
        <TopicSenses key={topic} topic={topic} tree={tree.data} />
      ) : (
        <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">{t('browse.pickTopic')}</p>
      )}
    </div>
  )
}
