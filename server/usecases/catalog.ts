import { type EntrySnapshot, formMatch, projectPublicEntry, projectPublicSense } from '@server/domain/catalog-view'
import type { Fact, FactOf } from '@server/domain/fact'
import { contentKeyOf } from '@server/domain/fact-kinds'
import type { EntryNode, SenseNode } from '@server/domain/nodes'
import { principalRef } from '@server/domain/principal'
import { normalizeTerm } from '@server/domain/term'
import type {
  CreateEntryInput,
  CreateSenseInput,
  FormMatch,
  NodeLocation,
  PublicEntry,
  PublicSenseWithEntry,
  Stats,
} from '@shared/catalog'
import { type EntryId, formTypeSchema, type SenseId } from '@shared/facts'
import type { Deps } from './deps'
import { InvalidReferenceError, NotFoundError } from './errors'
import { type Actor, submitFact } from './facts'
import type { PageRequest } from './ports'

type WriteDeps = Pick<Deps, 'nodes' | 'facts' | 'reviewQueue' | 'clock' | 'ids'>

/** Ensures the entry node exists and its `entry` fact is live. Converges on retry. */
export async function createEntry(
  deps: WriteDeps,
  actor: Actor,
  input: CreateEntryInput,
): Promise<{ entry: EntryNode; fact: Fact; created: boolean }> {
  const lemma = normalizeTerm(input.lemma)
  const draft: EntryNode = {
    id: deps.ids.entry(),
    lemma,
    createdBy: principalRef(actor.principal),
    createdAt: deps.clock.now().toISOString(),
  }
  const entry = (await deps.nodes.findEntryByLemma(lemma)) ?? (await deps.nodes.insertEntry(draft))
  const { fact } = await submitFact(deps, actor, { kind: 'entry', subject_id: entry.id, payload: {} })
  return { entry, fact, created: entry.id === draft.id }
}

/** Creates a sense with its gloss fact atomically. Idempotent by (entry, POS, gloss). */
export async function createSense(
  deps: WriteDeps,
  actor: Actor,
  input: CreateSenseInput,
): Promise<{ sense: SenseNode; fact: Fact; created: boolean }> {
  const entry = await deps.nodes.findEntry(input.entry_id)
  if (!entry) throw new InvalidReferenceError(`Entry ${input.entry_id} does not exist.`)

  const payload = { gloss: input.gloss }
  const contentKey = contentKeyOf('sense', payload)
  const existing = await deps.nodes.findSenseByGloss(entry.id, input.pos, contentKey)
  if (existing) return { ...existing, created: false }

  const now = deps.clock.now().toISOString()
  const author = principalRef(actor.principal)
  const sense: SenseNode = {
    id: deps.ids.sense(),
    entryId: entry.id,
    pos: input.pos,
    createdBy: author,
    createdAt: now,
  }
  const fact: FactOf<'sense'> = {
    id: deps.ids.fact(),
    kind: 'sense',
    subjectId: sense.id,
    objectId: null,
    contentKey,
    payload,
    status: 'pending',
    supersedesId: null,
    author,
    review: null,
    createdAt: now,
    updatedAt: now,
  }
  const stored = await deps.nodes.insertSenseWithFact(sense, fact)
  const created = stored.sense.id === sense.id
  if (created) await deps.reviewQueue.enqueue([{ factId: fact.id, traceId: actor.traceId }])
  return { ...stored, created }
}

async function snapshotOf(deps: Pick<Deps, 'nodes'>, lemma: string): Promise<EntrySnapshot> {
  const entry = await deps.nodes.findEntryByLemma(normalizeTerm(lemma))
  if (!entry) throw new NotFoundError(`No entry for ${JSON.stringify(lemma)}.`)
  return deps.nodes.loadEntrySnapshot(entry)
}

export async function getPublicEntry(deps: Pick<Deps, 'nodes'>, lemma: string): Promise<PublicEntry> {
  const view = projectPublicEntry(await snapshotOf(deps, lemma))
  if (!view) throw new NotFoundError(`No entry for ${JSON.stringify(lemma)}.`)
  return view
}

export async function getPublicSense(deps: Pick<Deps, 'nodes'>, id: SenseId): Promise<PublicSenseWithEntry> {
  const sense = await deps.nodes.findSense(id)
  const entry = sense && (await deps.nodes.findEntry(sense.entryId))
  const view = entry && projectPublicSense(await deps.nodes.loadEntrySnapshot(entry), id)
  if (!view) throw new NotFoundError(`Sense ${id} not found.`)
  return view
}

/** Exact match on a published form. No fuzzy or lemma fallback: no match is not found. */
export async function lookupForm(deps: Pick<Deps, 'nodes'>, form: string): Promise<FormMatch[]> {
  const keys = formTypeSchema.options.map((type) => contentKeyOf('form', { form, type }))
  const matches = await deps.nodes.findPublishedForms(keys)
  if (matches.length === 0) throw new NotFoundError(`No entry has the form ${JSON.stringify(form)}.`)
  return matches.map(({ entry, fact }) => formMatch(entry, fact))
}

export function searchEntries(deps: Pick<Deps, 'nodes'>, prefix: string, page: PageRequest) {
  return deps.nodes.searchPublishedEntries(normalizeTerm(prefix), page)
}

/** The management view: the entry with every fact in every status. */
export async function getManagedEntry(
  deps: Pick<Deps, 'nodes'>,
  lemma: string,
): Promise<{ entry: EntryNode; senses: SenseNode[]; facts: Fact[] }> {
  const snapshot = await snapshotOf(deps, lemma)
  const facts = new Map([...snapshot.facts, ...snapshot.incoming].map((fact) => [fact.id, fact]))
  return { entry: snapshot.entry, senses: snapshot.senses, facts: [...facts.values()] }
}

/** The entry that owns a node id: the entry itself, or a sense's entry. Ids are UUIDs, so at most one matches. */
export async function locateNode(deps: Pick<Deps, 'nodes'>, id: string): Promise<NodeLocation> {
  const entry = await deps.nodes.findEntry(id as EntryId)
  if (entry) return { node_type: 'entry', entry: { id: entry.id, lemma: entry.lemma } }
  const sense = await deps.nodes.findSense(id as SenseId)
  if (sense) return { node_type: 'sense', entry: { id: sense.entryId, lemma: sense.lemma } }
  throw new NotFoundError(`No entry or sense has the id ${id}.`)
}

export async function getStats(deps: Pick<Deps, 'facts' | 'feedback'>): Promise<Stats> {
  const [facts, openFeedback] = await Promise.all([deps.facts.countByKindAndStatus(), deps.feedback.countOpen()])
  return { facts, open_feedback: openFeedback }
}
