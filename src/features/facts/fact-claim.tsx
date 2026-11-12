import type { FactDto } from '@shared/facts'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { useNodeLocation } from './hooks'
import { summarizeFact } from './summary'

function RelationTarget({ senseId }: { senseId: string }) {
  const location = useNodeLocation(senseId)
  return <span className="font-serif">{location.data?.entry.lemma ?? '…'}</span>
}

/** What a fact claims, typeset the way its kind reads in a dictionary. */
export function FactClaim({ fact, size = 'sm' }: { fact: FactDto; size?: 'sm' | 'lg' }) {
  const { t } = useTranslation()
  const large = size === 'lg'
  switch (fact.kind) {
    case 'example':
      return <span className={cn('font-serif italic', large && 'text-2xl')}>{fact.payload.text}</span>
    case 'senses':
      return (
        <ol className={cn('flex list-decimal flex-col gap-0.5 pl-5 font-serif', large && 'text-lg')}>
          {fact.payload.senses.map((sense) => (
            <li key={sense.id} className={cn(sense.rank === 'extra' && 'text-muted-foreground')}>
              <span className="text-muted-foreground text-sm italic">{t(`pos.${sense.pos}`)}</span> {sense.gloss}
            </li>
          ))}
        </ol>
      )
    case 'translation':
      return (
        <span className={cn('inline-flex items-baseline gap-2', large && 'text-2xl')}>
          {fact.payload.of === 'sense' ? null : (
            <span className="text-muted-foreground text-sm">{t(`factKind.${fact.payload.of}`)}</span>
          )}
          {fact.payload.text}
        </span>
      )
    case 'relation':
      return (
        <span className={cn('inline-flex items-baseline gap-2', large && 'text-2xl')}>
          <span className="text-muted-foreground text-sm">{t(`relationType.${fact.payload.type}`)}</span>
          <RelationTarget senseId={fact.payload.target_sense_id} />
        </span>
      )
    default:
      return <span className={cn(large && 'text-xl')}>{summarizeFact(fact) || t(`factKind.${fact.kind}`)}</span>
  }
}
