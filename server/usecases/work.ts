import { type ManagedEntryView, managedEntryView } from '@server/domain/catalog-view'
import { principalRef } from '@server/domain/principal'
import type { Lemma } from '@server/domain/term'
import { completeDecision, entryGaps, leaseExpiry, type WorkLease } from '@server/domain/work'
import type { EntryId } from '@shared/facts'
import { type CompleteWorkInput, DEFAULT_LEASE_SECONDS, type Gap, type WorkLeaseId } from '@shared/work'
import type { Deps } from './deps'
import { ConflictError, NotFoundError } from './errors'
import type { Actor } from './facts'

export interface WorkClaim {
  lease: WorkLease & { lemma: Lemma }
  entry: ManagedEntryView
  gaps: Gap[]
}

/** Leases the least recently claimed entry to the caller, with what the entry still lacks; null when none is free. */
export async function claimWork(
  deps: Pick<Deps, 'work' | 'nodes' | 'clock' | 'ids'>,
  actor: Actor,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
): Promise<WorkClaim | null> {
  const now = deps.clock.now()
  const claimed = await deps.work.claimNext(
    { id: deps.ids.lease(), holder: principalRef(actor.principal), expiresAt: leaseExpiry(now, leaseSeconds) },
    now.toISOString(),
  )
  if (!claimed) return null
  const { lease, entry } = claimed
  const snapshot = await deps.nodes.loadEntrySnapshot(entry)
  return { lease: { ...lease, lemma: entry.lemma }, entry: managedEntryView(snapshot), gaps: entryGaps(snapshot) }
}

/** The holder records its work and gives the entry back. The lease is gone afterwards, so a repeat is not found. */
export async function completeWork(
  deps: Pick<Deps, 'work' | 'clock'>,
  actor: Actor,
  id: WorkLeaseId,
  input: CompleteWorkInput,
): Promise<{ entryId: EntryId; lastWorkedAt: string }> {
  const lease = await deps.work.findLease(id)
  if (!lease) throw new NotFoundError(`Work lease ${id} not found.`)
  const now = deps.clock.now()
  const decision = completeDecision(lease, principalRef(actor.principal), now)
  if (decision === 'not_holder') throw new ConflictError(`Work lease ${id} is held by ${lease.holder}.`)
  if (decision === 'expired') throw new ConflictError(`Work lease ${id} expired at ${lease.expiresAt}.`)
  const at = now.toISOString()
  if (!(await deps.work.complete(lease, at, input.note ?? null))) {
    throw new ConflictError(`Work lease ${id} changed concurrently; claim again.`)
  }
  return { entryId: lease.entryId, lastWorkedAt: at }
}
