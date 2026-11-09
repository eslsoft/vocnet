import { claim, claimDecision, close, closeDecision, type FeedbackRecord, isClosed } from '@server/domain/feedback'
import { principalRef } from '@server/domain/principal'
import type { EntryId, FactId, SenseId } from '@shared/facts'
import type {
  FeedbackId,
  FeedbackStatus,
  FeedbackTargetType,
  ResolveFeedbackInput,
  SubmitFeedbackInput,
} from '@shared/feedback'
import type { Deps } from './deps'
import { ConflictError, ForbiddenError, InvalidReferenceError, NotFoundError } from './errors'
import type { Actor } from './facts'
import type { PageRequest } from './ports'

type LookupDeps = Pick<Deps, 'nodes' | 'facts'>

const targetExists: { [T in FeedbackTargetType]: (deps: LookupDeps, id: string) => Promise<boolean> } = {
  entry: async (deps, id) => (await deps.nodes.findEntry(id as EntryId)) !== null,
  sense: async (deps, id) => (await deps.nodes.findSense(id as SenseId)) !== null,
  fact: async (deps, id) => (await deps.facts.find(id as FactId)) !== null,
}

/** Anyone may report a problem with an entry, a sense, or a fact. */
export async function submitFeedback(
  deps: Pick<Deps, 'nodes' | 'facts' | 'feedback' | 'clock' | 'ids'>,
  input: SubmitFeedbackInput,
): Promise<FeedbackRecord> {
  if (!(await targetExists[input.target_type](deps, input.target_id))) {
    throw new InvalidReferenceError(`${input.target_type} ${input.target_id} does not exist.`)
  }
  const now = deps.clock.now().toISOString()
  const item: FeedbackRecord = {
    id: deps.ids.feedback(),
    targetType: input.target_type,
    targetId: input.target_id,
    message: input.message,
    status: 'open',
    assignee: null,
    claimExpiresAt: null,
    resolutionNote: null,
    resolutionFactIds: [],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  }
  await deps.feedback.insert(item)
  return item
}

export function listFeedback(deps: Pick<Deps, 'feedback'>, filter: { status?: FeedbackStatus }, page: PageRequest) {
  return deps.feedback.list(filter, page)
}

async function findFeedback(deps: Pick<Deps, 'feedback'>, id: FeedbackId): Promise<FeedbackRecord> {
  const item = await deps.feedback.find(id)
  if (!item) throw new NotFoundError(`Feedback ${id} not found.`)
  return item
}

async function write(deps: Pick<Deps, 'feedback'>, next: FeedbackRecord, previous: FeedbackRecord) {
  if (!(await deps.feedback.update(next, previous.revision))) {
    throw new ConflictError('The feedback changed concurrently; read it again.')
  }
  return next
}

/** Takes a one-hour lease so two agents do not work the same report. */
export async function claimFeedback(
  deps: Pick<Deps, 'feedback' | 'clock'>,
  actor: Actor,
  id: FeedbackId,
): Promise<FeedbackRecord> {
  const item = await findFeedback(deps, id)
  const who = principalRef(actor.principal)
  const now = deps.clock.now()
  const decision = claimDecision(item, who, now)
  if (decision === 'closed') throw new ConflictError(`Feedback is already ${item.status}.`)
  if (decision === 'held')
    throw new ConflictError(`Feedback is claimed by ${item.assignee} until ${item.claimExpiresAt}.`)
  return write(deps, claim(item, who, now), item)
}

/** Closes a claimed item, linking the correcting facts. Repeating the close is a no-op. */
export async function resolveFeedback(
  deps: Pick<Deps, 'feedback' | 'facts' | 'clock'>,
  actor: Actor,
  id: FeedbackId,
  input: ResolveFeedbackInput,
): Promise<FeedbackRecord> {
  const item = await findFeedback(deps, id)
  const who = principalRef(actor.principal)
  if (isClosed(item.status) && item.assignee === who) return item
  const decision = closeDecision(item, who)
  if (decision === 'not_claimed') throw new ConflictError(`Claim the feedback before closing it; it is ${item.status}.`)
  if (decision === 'not_holder') throw new ForbiddenError(`Feedback is claimed by ${item.assignee}.`)

  const factIds = input.resolution === 'resolved' ? input.fact_ids : []
  for (const factId of factIds) {
    if (!(await deps.facts.find(factId))) throw new InvalidReferenceError(`Fact ${factId} does not exist.`)
  }
  const outcome = { status: input.resolution, note: input.note ?? null, factIds }
  return write(deps, close(item, outcome, deps.clock.now()), item)
}
