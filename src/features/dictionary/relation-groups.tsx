import type { RelatedSense, RelationGroup, Relations } from '@shared/catalog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '@/shared/ui/button'
import { wordPath } from './entry-format'

const GROUPS: RelationGroup[] = ['synonyms', 'antonyms', 'broader', 'narrower', 'parts', 'part_of']
const SHOWN = 12

/** The lemma of each related sense, numbered when one lemma has several senses in the group. */
function labels(items: RelatedSense[]): string[] {
  return items.map((item) => {
    const same = items.filter((other) => other.lemma === item.lemma)
    return same.length > 1 ? `${item.lemma} ${same.indexOf(item) + 1}` : item.lemma
  })
}

function RelationRow({ group, items }: { group: RelationGroup; items: RelatedSense[] }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const names = labels(items)
  const shown = expanded ? items : items.slice(0, SHOWN)
  return (
    <div className="grid gap-1 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
      <dt className="pt-0.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {t(`entry.relations.${group}`)}
      </dt>
      <dd className="flex flex-wrap items-center gap-1.5">
        {shown.map((item, index) => (
          <Link
            key={item.sense_id}
            to={wordPath(item.lemma, item.sense_id)}
            title={item.gloss}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-sm transition-colors hover:border-primary/50 hover:bg-accent hover:text-accent-foreground"
          >
            {names[index]}
            {item.domain ? (
              <span className="rounded bg-muted px-1 text-[0.6875rem] text-muted-foreground">
                {t(`entry.domains.${item.domain}`)}
              </span>
            ) : null}
          </Link>
        ))}
        {items.length > SHOWN ? (
          <Button variant="link" size="xs" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? t('entry.showFewer') : t('entry.showMore', { count: items.length - SHOWN })}
          </Button>
        ) : null}
      </dd>
    </div>
  )
}

/** The sense's place in the network: synonyms, opposites, broader and narrower terms, parts and wholes. */
export function RelationGroups({ relations }: { relations: Relations }) {
  const groups = GROUPS.filter((group) => relations[group].length > 0)
  if (groups.length === 0) return null
  return (
    <dl className="flex flex-col gap-2 border-l-2 border-primary/25 pl-3">
      {groups.map((group) => (
        <RelationRow key={group} group={group} items={relations[group]} />
      ))}
    </dl>
  )
}
