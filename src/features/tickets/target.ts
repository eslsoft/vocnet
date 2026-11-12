import type { FactId } from '@shared/facts'
import type { ListedTicketDto } from '@shared/tickets'
import { useTranslation } from 'react-i18next'
import { useFact } from '@/features/facts'

/** What a ticket is about: a fact, read for its claim and review; an entry or sense; or a missing lemma. */
export function useTicketTarget(ticket: Pick<ListedTicketDto, 'target_type' | 'target'>) {
  const { t } = useTranslation()
  const fact = useFact(ticket.target_type === 'fact' ? (ticket.target as FactId) : null)
  return {
    fact: fact.data ?? null,
    label: fact.data ? t(`factKind.${fact.data.kind}`) : t(`tickets.targetType.${ticket.target_type}`),
    error: fact.error,
  }
}
