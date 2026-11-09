import { projectPublicEntry, projectPublicSense, publicFactIds } from '@server/domain/catalog-view'
import { factKinds } from '@server/domain/fact-kinds'
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
import { ConflictError, ForbiddenError, InvalidReferenceError, NotFoundError, RateLimitedError } from './errors'
import { type Actor, getFact } from './facts'
import type { PageRequest } from './ports'
import { refreshWork } from './work-scores'

type LookupDeps = Pick<Deps, 'nodes' | 'facts'>

async function publicEntryOf(deps: LookupDeps, id: EntryId) {
  const entry = await deps.nodes.findEntry(id)
  return entry && projectPublicEntry(await deps.nodes.loadEntrySnapshot(entry))
}

async function entryIdOf(deps: LookupDeps, subjectType: 'entry' | 'sense', subjectId: string): Promise<EntryId | null> {
  if (subjectType === 'entry') return subjectId as EntryId
  return (await deps.nodes.findSense(subjectId as SenseId))?.entryId ?? null
}

// Feedback follows the public read rules: only what the public API shows can be reported.
const targetIsPublic: { [T in FeedbackTargetType]: (deps: LookupDeps, id: string) => Promise<boolean> } = {
  entry: async (deps, id) => (await publicEntryOf(deps, id as EntryId)) !== null,
  sense: async (deps, id) => {
    const sense = await deps.nodes.findSense(id as SenseId)
    const entry = sense && (await deps.nodes.findEntry(sense.entryId))
    return entry !== null && projectPublicSense(await deps.nodes.loadEntrySnapshot(entry), id as SenseId) !== null
  },
  fact: async (deps, id) => {
    const fact = await deps.facts.find(id as FactId)
    if (fact?.status !== 'published') return false
    const entryId = await entryIdOf(deps, factKinds[fact.kind].subject, fact.subjectId)
    const view = entryId && (await publicEntryOf(deps, entryId))
    return view !== null && publicFactIds(view).has(fact.id)
  },
}

/** Anyone may report a problem with a public entry, sense, or fact, a few times a minute per client. */
export async function submitFeedback(
  deps: Pick<Deps, 'nodes' | 'facts' | 'work' | 'feedback' | 'feedbackLimiter' | 'clock' | 'ids'>,
  client: string,
  input: SubmitFeedbackInput,
): Promise<FeedbackRecord> {
  if (!(await deps.feedbackLimiter.allow(client))) {
    throw new RateLimitedError('Too much feedback from this address; try again in a minute.')
  }
  if (!(await targetIsPublic[input.target_type](deps, input.target_id))) {
    throw new NotFoundError(`No public ${input.target_type} ${input.target_id}.`)
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
  await refreshFlagged(deps, item)
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

/** Open feedback on a fact makes the fact weak, so its entries' scores follow the feedback's status. */
async function refreshFlagged(deps: Pick<Deps, 'facts' | 'nodes' | 'work'>, item: FeedbackRecord) {
  if (item.targetType !== 'fact') return
  const fact = await getFact(deps, item.targetId as FactId)
  await refreshWork(deps, [fact.subjectId, fact.objectId])
}

/** Closes a claimed item, linking the correcting facts. Repeating the close is a no-op. */
export async function resolveFeedback(
  deps: Pick<Deps, 'feedback' | 'facts' | 'nodes' | 'work' | 'clock'>,
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
  const closed = await write(deps, close(item, outcome, deps.clock.now()), item)
  await refreshFlagged(deps, closed)
  return closed
}
