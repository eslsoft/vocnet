import type { FactId } from '@shared/facts'
import type { ListedFeedbackDto } from '@shared/feedback'
import { useTranslation } from 'react-i18next'
import { useFact } from '@/features/facts'

/** What a ticket is about: a fact, read for its claim and review, or an entry or sense. */
export function useTicketTarget(ticket: Pick<ListedFeedbackDto, 'target_type' | 'target_id'>) {
  const { t } = useTranslation()
  const fact = useFact(ticket.target_type === 'fact' ? (ticket.target_id as FactId) : null)
  return {
    fact: fact.data ?? null,
    label: fact.data ? t(`factKind.${fact.data.kind}`) : t(`tickets.targetType.${ticket.target_type}`),
    error: fact.error,
  }
}
