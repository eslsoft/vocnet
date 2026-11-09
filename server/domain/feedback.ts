import type { FactId } from '@shared/facts'
import type { FeedbackId, FeedbackStatus, FeedbackTargetType } from '@shared/feedback'
import type { PrincipalRef } from './principal'

export const CLAIM_LEASE_MS = 60 * 60 * 1000

export interface FeedbackRecord {
  id: FeedbackId
  targetType: FeedbackTargetType
  targetId: string
  message: string
  status: FeedbackStatus
  assignee: PrincipalRef | null
  claimExpiresAt: string | null
  resolutionNote: string | null
  resolutionFactIds: FactId[]
  /** Bumped on every write; writes are compare-and-set on it. */
  revision: number
  createdAt: string
  updatedAt: string
}

export function isClosed(status: FeedbackStatus): boolean {
  return status === 'resolved' || status === 'dismissed'
}

/** Open items are claimable; a claim is claimable again by anyone once its lease expires, and by its holder at any time. */
export function claimDecision(item: FeedbackRecord, who: PrincipalRef, now: Date): 'claimable' | 'held' | 'closed' {
  if (isClosed(item.status)) return 'closed'
  if (item.status === 'open' || item.assignee === who) return 'claimable'
  return item.claimExpiresAt !== null && Date.parse(item.claimExpiresAt) <= now.getTime() ? 'claimable' : 'held'
}

export function claim(item: FeedbackRecord, who: PrincipalRef, now: Date): FeedbackRecord {
  return {
    ...item,
    status: 'claimed',
    assignee: who,
    claimExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS).toISOString(),
    revision: item.revision + 1,
    updatedAt: now.toISOString(),
  }
}

/** Only the claim holder closes an item. */
export function closeDecision(item: FeedbackRecord, who: PrincipalRef): 'allowed' | 'not_claimed' | 'not_holder' {
  if (item.status !== 'claimed') return 'not_claimed'
  return item.assignee === who ? 'allowed' : 'not_holder'
}

export function close(
  item: FeedbackRecord,
  outcome: { status: 'resolved' | 'dismissed'; note: string | null; factIds: FactId[] },
  now: Date,
): FeedbackRecord {
  return {
    ...item,
    status: outcome.status,
    claimExpiresAt: null,
    resolutionNote: outcome.note,
    resolutionFactIds: outcome.factIds,
    revision: item.revision + 1,
    updatedAt: now.toISOString(),
  }
}
