import { principalRef } from '@server/domain/principal'
import type { Lemma } from '@server/domain/term'
import { topicViews } from '@server/domain/topics'
import {
  AGENT_TYPES,
  completeDecision,
  itemState,
  leaseExpiry,
  type WorkItem,
  type WorkLease,
} from '@server/domain/work'
import { type WorkContext, workContext } from '@server/domain/work-context'
import type { EntryId } from '@shared/facts'
import {
  type ClaimWorkInput,
  type CompleteWorkInput,
  DEFAULT_LEASE_SECONDS,
  isOptionalGap,
  type WorkItemId,
  type WorkItemState,
  type WorkLeaseId,
  type WorkType,
} from '@shared/work'
import type { Deps } from './deps'
import { ConflictError, InvalidReferenceError, InvalidRequestError, NotFoundError } from './errors'
import type { Actor } from './facts'
import { refreshEntries } from './refresh'

export interface ClaimedItem {
  item: WorkItem
  lemma: Lemma
  context: WorkContext
}

export interface WorkClaim {
  lease: WorkLease
  items: ClaimedItem[]
}

/**
 * Leases up to `limit` items of one type to the caller: the type of the first free item of the
 * production queue (among `types` when given), then that type's next items in queue order, each
 * with the context its type needs. Null when no item is free.
 */
/** Work types not handed out for now; their items stay in the queue. Grammar: paused by the owner 2026-11-12. */
const PAUSED_TYPES: readonly WorkType[] = ['grammar']

export async function claimWork(
  deps: Pick<Deps, 'work' | 'nodes' | 'reference' | 'topics' | 'clock' | 'ids'>,
  actor: Actor,
  input: ClaimWorkInput,
): Promise<WorkClaim | null> {
  const now = deps.clock.now()
  const claimed = await deps.work.claim(
    {
      id: deps.ids.lease(),
      holder: principalRef(actor.principal),
      expiresAt: leaseExpiry(now, input.lease_seconds ?? DEFAULT_LEASE_SECONDS),
    },
    // An item the server classifies itself is never handed to an agent.
    (input.types ?? AGENT_TYPES).filter((type) => AGENT_TYPES.includes(type) && !PAUSED_TYPES.includes(type)),
    input.limit,
    now.toISOString(),
  )
  if (!claimed) return null
  // The lease names the entry of every item it leased.
  const [contexts, taxonomy] = await Promise.all([
    Promise.all(claimed.lease.entryIds.map(async (id) => [id, await entryContext(deps, id)] as const)).then(
      (entries) => new Map(entries),
    ),
    deps.topics.list().then(topicViews),
  ])
  return {
    lease: claimed.lease,
    items: claimed.items.map((item) => {
      const entry = contexts.get(item.entryId)!
      return { item, lemma: entry.lemma, context: workContext(item, entry.snapshot, entry.reference, taxonomy) }
    }),
  }
}

async function entryContext(deps: Pick<Deps, 'nodes' | 'reference'>, id: EntryId) {
  const entry = await deps.nodes.findEntry(id)
  if (!entry) throw new Error(`Work item entry ${id} does not exist.`)
  const [snapshot, reference] = await Promise.all([
    deps.nodes.loadEntrySnapshot(entry),
    deps.reference.forLemma(entry.lemma),
  ])
  return { lemma: entry.lemma, snapshot, reference }
}

/** Where each item a pass worked stands once its entry is rescored. */
export interface WorkCompletion {
  leaseId: WorkLeaseId
  items: Array<{ id: WorkItemId; state: WorkItemState; attempts: number }>
}

/**
 * The holder ends its pass: the items it names were worked, the rest of the lease is released
 * without an attempt, and the lease's entries are rescored, which draws each worked item's verdict
 * (or keeps it for its reviews). The lease is gone afterwards, so a repeat is not found.
 */
export async function completeWork(
  deps: Pick<Deps, 'work' | 'nodes' | 'reference' | 'publicViews' | 'topics' | 'clock' | 'ids'>,
  actor: Actor,
  id: WorkLeaseId,
  input: CompleteWorkInput,
): Promise<WorkCompletion> {
  const lease = await deps.work.findLease(id)
  if (!lease) throw new NotFoundError(`Work lease ${id} not found.`)
  const now = deps.clock.now()
  const decision = completeDecision(lease, principalRef(actor.principal), now)
  if (decision === 'not_holder') throw new ConflictError(`Work lease ${id} is held by ${lease.holder}.`)
  if (decision === 'expired') throw new ConflictError(`Work lease ${id} expired at ${lease.expiresAt}.`)
  const foreign = input.items.filter((item) => !lease.itemIds.includes(item.id))
  if (foreign.length > 0) {
    throw new InvalidReferenceError(
      `Work lease ${id} did not lease ${foreign.map((item) => item.id).join(', ')}; complete only the items it claimed.`,
    )
  }
  if (!isOptionalGap(lease.type) && input.items.some((item) => item.found_none || item.blocked_on?.length)) {
    throw new InvalidRequestError(
      `A ${lease.type} item is a required slot: found_none and blocked_on are for optional slots only. Fill it, or leave a note.`,
    )
  }
  const worked = input.items.map((item) => ({
    id: item.id,
    note: item.note,
    foundNone: item.found_none ?? false,
    blockedOn: item.blocked_on ?? [],
  }))
  if (!(await deps.work.complete(lease, worked, now.toISOString()))) {
    throw new ConflictError(`Work lease ${id} expired while it was being completed; claim again.`)
  }
  await refreshEntries(deps, [...lease.entryIds])
  const after = new Map((await deps.work.findItems(input.items.map((item) => item.id))).map((item) => [item.id, item]))
  return {
    leaseId: lease.id,
    items: input.items.map(({ id: itemId }) => {
      const item = after.get(itemId)
      return item
        ? { id: itemId, state: itemState(item), attempts: item.attempts }
        : { id: itemId, state: 'closed', attempts: 0 }
    }),
  }
}

/**
 * How long an expired lease is kept, so a holder that completes late still learns that its lease
 * expired (409) rather than that it never existed (404).
 */
export const EXPIRED_LEASE_RETENTION_MS = 24 * 60 * 60 * 1000

/** Deletes the leases that expired more than a day ago; the cron runs it. */
export async function purgeExpiredLeases(deps: Pick<Deps, 'work' | 'clock'>): Promise<number> {
  return deps.work.purgeLeases(new Date(deps.clock.now().getTime() - EXPIRED_LEASE_RETENTION_MS).toISOString())
}
