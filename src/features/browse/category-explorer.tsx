import type { Member, PublicEntry } from '@shared/catalog'
import type { RelationDomain } from '@shared/facts'
import { ChevronRight, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { CefrBadge, DomainSwitch, useEntry, wordPath } from '@/features/dictionary'
import { cn } from '@/shared/lib/cn'
import { useSearchParamState } from '@/shared/lib/search-params'
import { Button } from '@/shared/ui/button'
import { ErrorNotice } from '@/shared/ui/error-notice'
import { Skeleton } from '@/shared/ui/skeleton'
import { useDirectKinds } from './hooks'

/** Category words a learner explores first; each opens the sense of it with the most kinds. */
export const CATEGORY_ROOTS = [
  'animal',
  'food',
  'drink',
  'vehicle',
  'plant',
  'fruit',
  'vegetable',
  'furniture',
  'tool',
  'sport',
  'colour',
  'instrument',
] as const

/** The senses of an entry that have kinds, the one with the most first. */
function categorySenses(entry: PublicEntry) {
  return entry.meanings
    .flatMap((meaning) => meaning.senses.map((sense) => ({ ...sense, pos: meaning.pos })))
    .filter((sense) => sense.relations.narrower.length > 0)
    .sort((a, b) => b.relations.narrower.length - a.relations.narrower.length)
}

function KindNode({ member, domain, level }: { member: Member; domain: RelationDomain | undefined; level: number }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <li>
      <div className="flex items-center gap-1.5 py-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-expanded={open}
          aria-label={t('browse.kindsOf', { lemma: member.lemma })}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRight aria-hidden="true" className={cn('transition-transform', open && 'rotate-90')} />
        </Button>
        <MemberLabel member={member} />
      </div>
      {open ? (
        <div className="ml-3.5 border-l pl-3">
          <Kinds senseId={member.sense_id} domain={domain} level={level + 1} />
        </div>
      ) : null}
    </li>
  )
}

function MemberLabel({ member }: { member: Member }) {
  return (
    <Link
      to={wordPath(member.lemma, member.sense_id)}
      title={member.gloss}
      className="group flex min-w-0 items-baseline gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
    >
      <span className="shrink-0 font-medium group-hover:text-primary">{member.lemma}</span>
      {member.cefr ? <CefrBadge level={member.cefr} className="shrink-0 self-center" /> : null}
      {member.translation ? (
        <span lang="zh-CN" className="truncate text-muted-foreground text-sm">
          {member.translation}
        </span>
      ) : null}
    </Link>
  )
}

/** The direct kinds of one category sense, each expandable into its own kinds. */
function Kinds({ senseId, domain, level }: { senseId: string; domain: RelationDomain | undefined; level: number }) {
  const { t } = useTranslation()
  const kinds = useDirectKinds(senseId, domain)
  if (kinds.error) return <ErrorNotice error={kinds.error} />
  if (!kinds.data) {
    return (
      <p className="flex items-center gap-2 py-1 text-muted-foreground text-sm" role="status">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        {t('browse.loadingKinds')}
      </p>
    )
  }
  if (kinds.data.length === 0) return <p className="py-1 text-muted-foreground text-sm">{t('browse.noKinds')}</p>
  return (
    <>
      <ul className={cn(level === 0 && 'grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3')}>
        {kinds.data.map((member) => (
          <KindNode key={member.sense_id} member={member} domain={domain} level={level} />
        ))}
      </ul>
      {kinds.hasNextPage ? (
        <Button variant="link" size="sm" disabled={kinds.isFetchingNextPage} onClick={() => void kinds.fetchNextPage()}>
          {t('common.loadMore')}
        </Button>
      ) : null}
    </>
  )
}

function RootCategory({ lemma, domain }: { lemma: string; domain: RelationDomain | undefined }) {
  const { t } = useTranslation()
  const entry = useEntry(lemma, domain)
  const [params, setParam] = useSearchParamState()
  if (entry.error) return <ErrorNotice error={entry.error} />
  if (!entry.data) return <Skeleton className="h-64" />
  const senses = categorySenses(entry.data.entry)
  const chosen = senses.find((sense) => sense.id === params.get('sense')) ?? senses[0]
  if (!chosen) return <p className="text-muted-foreground">{t('browse.noKinds')}</p>
  return (
    <section aria-labelledby="category-title" className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h2 id="category-title" className="font-semibold font-serif text-3xl">
          <Link className="hover:text-primary" to={wordPath(lemma, chosen.id)}>
            {lemma}
          </Link>
        </h2>
        <p className="text-muted-foreground">{chosen.gloss}</p>
        {senses.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 text-sm">
            <span className="text-muted-foreground text-xs">{t('browse.otherSenses')}</span>
            {senses.map((sense, index) => (
              <Button
                key={sense.id}
                variant={sense.id === chosen.id ? 'secondary' : 'ghost'}
                size="xs"
                aria-pressed={sense.id === chosen.id}
                title={sense.gloss}
                onClick={() => setParam('sense', index === 0 ? null : sense.id)}
              >
                {t('browse.senseNumber', { number: index + 1 })}
              </Button>
            ))}
          </div>
        ) : null}
      </header>
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{t('browse.directKinds')}</h3>
      <Kinds key={`${chosen.id}-${domain ?? ''}`} senseId={chosen.id} domain={domain} level={0} />
    </section>
  )
}

/** Pick a category word and walk its kinds level by level, in the everyday or a specialist layer. */
export function CategoryExplorer({ domain }: { domain: RelationDomain | undefined }) {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const root = params.get('root')
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {t('browse.pickCategory')}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_ROOTS.map((lemma) => (
              <Button
                key={lemma}
                variant={root === lemma ? 'default' : 'outline'}
                size="sm"
                aria-pressed={root === lemma}
                onClick={() =>
                  setParams((current) => {
                    const next = new URLSearchParams(current)
                    next.set('root', lemma)
                    next.delete('sense')
                    return next
                  })
                }
              >
                {lemma}
              </Button>
            ))}
          </div>
        </fieldset>
        <DomainSwitch domain={domain} />
      </div>
      {root ? (
        <RootCategory key={root} lemma={root} domain={domain} />
      ) : (
        <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">{t('browse.pickHint')}</p>
      )}
    </div>
  )
}
