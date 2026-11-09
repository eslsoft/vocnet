import type { FeedbackId } from '@shared/feedback'
import { describe, expect, it } from 'vitest'
import { CLAIM_LEASE_MS, claim, claimDecision, close, closeDecision, type FeedbackRecord } from './feedback'

const now = new Date('2026-01-01T00:00:00.000Z')
const open: FeedbackRecord = {
  id: '00000000-0000-4000-8000-000000000001' as FeedbackId,
  targetType: 'entry',
  targetId: '00000000-0000-4000-8000-000000000002',
  message: 'Wrong gloss.',
  status: 'open',
  assignee: null,
  claimExpiresAt: null,
  resolutionNote: null,
  resolutionFactIds: [],
  revision: 0,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
}

describe('feedback lease', () => {
  it('claims for one hour and bumps the revision', () => {
    const claimed = claim(open, 'agent:a', now)
    expect(claimed).toMatchObject({ status: 'claimed', assignee: 'agent:a', revision: 1 })
    expect(Date.parse(claimed.claimExpiresAt ?? '') - now.getTime()).toBe(CLAIM_LEASE_MS)
  })

  it('lets others claim only after the lease expires; the holder may renew [spec: feedback/claim-lease]', () => {
    const claimed = claim(open, 'agent:a', now)
    expect(claimDecision(open, 'agent:b', now)).toBe('claimable')
    expect(claimDecision(claimed, 'agent:b', now)).toBe('held')
    expect(claimDecision(claimed, 'agent:a', now)).toBe('claimable')
    expect(claimDecision(claimed, 'agent:b', new Date(now.getTime() + CLAIM_LEASE_MS))).toBe('claimable')
    expect(claimDecision({ ...claimed, status: 'resolved' }, 'agent:a', now)).toBe('closed')
  })

  it('lets only the holder close a claimed item', () => {
    const claimed = claim(open, 'agent:a', now)
    expect(closeDecision(open, 'agent:a')).toBe('not_claimed')
    expect(closeDecision(claimed, 'agent:b')).toBe('not_holder')
    expect(closeDecision(claimed, 'agent:a')).toBe('allowed')
    expect(close(claimed, { status: 'dismissed', note: 'Not a problem.', factIds: [] }, now)).toMatchObject({
      status: 'dismissed',
      claimExpiresAt: null,
      resolutionNote: 'Not a problem.',
      revision: 2,
    })
  })
})
