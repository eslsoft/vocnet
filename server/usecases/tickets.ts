import { publicFactIds } from '@server/domain/catalog-view'
import { subjectTypeOf } from '@server/domain/fact-kinds'
import { principalRef } from '@server/domain/principal'
import { isClosed, resolve, type TicketRecord } from '@server/domain/tickets'
import type { EntryId, FactId, SenseId } from '@shared/facts'
import type {
  FeedbackTargetType,
  ResolveTicketInput,
  SubmitFeedbackInput,
  TicketId,
  TicketStatus,
  TicketType,
} from '@shared/tickets'
import type { WorkType } from '@shared/work'
import { requireCurator } from './access'
import type { Deps } from './deps'
import { ConflictError, InvalidReferenceError, NotFoundError, RateLimitedError } from './errors'
import type { Actor } from './facts'
import type { PageRequest } from './ports'
import { LIMIT_PERIOD_SECONDS } from './ports'
import { projectEntry, topicNamesOf } from './public-view'
import { refreshEntries } from './refresh'

type LookupDeps = Pick<Deps, 'nodes' | 'facts' | 'reference' | 'topics'>

async function publicEntryOf(deps: LookupDeps, id: EntryId) {
  const entry = await deps.nodes.findEntry(id)
  return entry && projectEntry(deps, entry, await topicNamesOf(deps))
}

async function entryIdOf(deps: LookupDeps, subjectType: 'entry' | 'sense' | 'fact', subjectId: string): Promise<EntryId | null> {
  if (subjectType === 'entry') return subjectId as EntryId
  if (subjectType === 'sense') return (await deps.nodes.findSense(subjectId as SenseId))?.entryId ?? null
  const fact = await deps.facts.find(subjectId as FactId)
  return fact ? entryIdOf(deps, subjectTypeOf(fact.kind, fact.payload), fact.subjectId) : null
}

// Feedback follows the public read rules: only what the public API shows can be reported.
const targetIsPublic: { [T in FeedbackTargetType]: (deps: LookupDeps, id: string) => Promise<boolean> } = {
  entry: async (deps, id) => (await publicEntryOf(deps, id as EntryId)) !== null,
  sense: async (deps, id) => {
    const sense = await deps.nodes.findSense(id as SenseId)
    const view = sense && (await publicEntryOf(deps, sense.entryId))
    return !!view?.meanings.some((meaning) => meaning.senses.some((candidate) => candidate.id === id))
  },
  fact: async (deps, id) => {
    const fact = await deps.facts.find(id as FactId)
    if (fact?.status !== 'published') return false
    const entryId = await entryIdOf(deps, subjectTypeOf(fact.kind, fact.payload), fact.subjectId)
    const view = entryId && (await publicEntryOf(deps, entryId))
    return !!view && publicFactIds(view).has(fact.id)
  },
}

/** A new open ticket; a target already holding an open ticket of the type keeps that one. */
export function newTicket(
  deps: Pick<Deps, 'ids' | 'clock'>,
  ticket: Pick<TicketRecord, 'type' | 'targetType' | 'target' | 'message'>,
): TicketRecord {
  const now = deps.clock.now().toISOString()
  return {
    id: deps.ids.ticket(),
    ...ticket,
    status: 'open',
    resolutionNote: null,
    resolutionFactIds: [],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Anyone may report a problem with a public entry, sense, or fact, a few times a minute per
 * client. The report is a feedback ticket for a curator; a target with an open feedback ticket
 * keeps that one.
 */
export async function submitFeedback(
  deps: Pick<Deps, 'nodes' | 'facts' | 'topics' | 'reference' | 'tickets' | 'feedbackLimiter' | 'clock' | 'ids'>,
  client: string,
  input: SubmitFeedbackInput,
): Promise<TicketRecord> {
  if (!(await deps.feedbackLimiter.allow(client))) {
    throw new RateLimitedError('Too much feedback from this address; try again in a minute.', LIMIT_PERIOD_SECONDS)
  }
  if (!(await targetIsPublic[input.target_type](deps, input.target_id))) {
    throw new NotFoundError(`No public ${input.target_type} ${input.target_id}.`)
  }
  return deps.tickets.open(
    newTicket(deps, { type: 'feedback', targetType: input.target_type, target: input.target_id, message: input.message }),
  )
}

export function listTickets(
  deps: Pick<Deps, 'tickets'>,
  filter: { status?: TicketStatus; type?: TicketType },
  page: PageRequest,
) {
  return deps.tickets.list(filter, page)
}

export async function getTicketWithEntry(deps: Pick<Deps, 'tickets'>, id: TicketId) {
  const ticket = await deps.tickets.findWithEntry(id)
  if (!ticket) throw new NotFoundError(`Ticket ${id} not found.`)
  return ticket
}

/**
 * A curator closes an open ticket: resolved names the facts that fixed it (each must exist), and
 * dismissed says why nothing needed fixing.
 */
export async function resolveTicket(
  deps: Pick<Deps, 'tickets' | 'facts' | 'clock'>,
  actor: Actor,
  id: TicketId,
  input: ResolveTicketInput,
): Promise<TicketRecord> {
  requireCurator(actor.principal)
  const ticket = await deps.tickets.find(id)
  if (!ticket) throw new NotFoundError(`Ticket ${id} not found.`)
  if (isClosed(ticket.status)) throw new ConflictError(`Ticket ${id} is already ${ticket.status}.`)
  const factIds = input.resolution === 'resolved' ? input.fact_ids : []
  for (const factId of factIds) {
    if (!(await deps.facts.find(factId))) throw new InvalidReferenceError(`Fact ${factId} does not exist.`)
  }
  const next = resolve(ticket, { status: input.resolution, note: input.note, factIds }, deps.clock.now())
  if (!(await deps.tickets.update(next, ticket.revision))) {
    throw new ConflictError('The ticket changed while it was being resolved.')
  }
  return next
}

/**
 * A curator settles a slot by hand when nothing can fill it ("main" has no -er comparative): the
 * slot counts as filled from now on, so its item closes.
 */
export async function settleSlot(
  deps: Pick<Deps, 'nodes' | 'facts' | 'topics' | 'work' | 'reference' | 'publicViews' | 'clock'>,
  actor: Actor,
  slot: { entryId: EntryId; type: WorkType; subjectId: string; note: string },
): Promise<void> {
  requireCurator(actor.principal)
  if (!(await deps.nodes.findEntry(slot.entryId))) throw new NotFoundError(`Entry ${slot.entryId} not found.`)
  await deps.work.recordPass({ ...slot, holder: principalRef(actor.principal), at: deps.clock.now().toISOString() })
  await refreshEntries(deps, [slot.subjectId])
}

