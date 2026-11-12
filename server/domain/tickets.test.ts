import type { FactId } from '@shared/facts'
import type { TicketId } from '@shared/tickets'
import { describe, expect, it } from 'vitest'
import { isClosed, resolve, type TicketRecord } from './tickets'

const ticket: TicketRecord = {
  id: 't0000000-0000-4000-8000-000000000001' as TicketId,
  type: 'stuck_work',
  targetType: 'entry',
  target: 'e0000000-0000-4000-8000-000000000001',
  message: 'Two passes made no progress.',
  status: 'open',
  resolutionNote: null,
  resolutionFactIds: [],
  revision: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('tickets', () => {
  it('closes only as resolved or dismissed [spec: tickets/resolve]', () => {
    expect(['open', 'resolved', 'dismissed'].map((status) => isClosed(status as never))).toEqual([false, true, true])
  })

  it('records the outcome, the fixing facts, and a new revision [spec: tickets/resolve]', () => {
    const fixed = 'f0000000-0000-4000-8000-000000000001' as FactId
    const now = new Date('2026-02-01T00:00:00.000Z')
    expect(resolve(ticket, { status: 'resolved', note: 'Corrected the gloss.', factIds: [fixed] }, now)).toEqual({
      ...ticket,
      status: 'resolved',
      resolutionNote: 'Corrected the gloss.',
      resolutionFactIds: [fixed],
      revision: 4,
      updatedAt: '2026-02-01T00:00:00.000Z',
    })
    expect(resolve(ticket, { status: 'dismissed', note: 'Nothing wrong.', factIds: [] }, now)).toMatchObject({
      status: 'dismissed',
      resolutionFactIds: [],
    })
  })
})
