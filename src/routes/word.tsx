import { relationDomainSchema } from '@shared/facts'
import { useParams, useSearchParams } from 'react-router'
import { EntryView } from '@/features/dictionary'

export default function WordPage() {
  const { lemma = '' } = useParams()
  const [params] = useSearchParams()
  const domain = relationDomainSchema.safeParse(params.get('domain'))
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <EntryView key={lemma} lemma={lemma} domain={domain.success ? domain.data : undefined} />
    </div>
  )
}
