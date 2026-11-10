import { type EntrySnapshot, type ManagedEntryView, managedEntryView } from '@server/domain/catalog-view'
import type { Fact, FactOf } from '@server/domain/fact'
import { contentKeyOf, meaningKeyOf } from '@server/domain/fact-kinds'
import type { EntryNode, SenseNode } from '@server/domain/nodes'
import { principalRef } from '@server/domain/principal'
import { formMatchOf, publicSenseOf, readDocument } from '@server/domain/public-view'
import { isLetterOfTheAlphabet, type Lemma, normalizeTerm } from '@server/domain/term'
import type {
  CreateEntryInput,
  CreateSenseInput,
  FormMatch,
  NodeLocation,
  PublicSenseWithEntry,
  Stats,
} from '@shared/catalog'
import { type EntryId, formTypeSchema, registerSchema, type SenseId } from '@shared/facts'
import type { LemmaReference } from '@shared/reference'
import type { Deps } from './deps'
import { InvalidReferenceError, NotFoundError } from './errors'
import { type Actor, submitFact } from './facts'
import type { PageRequest, StoredView } from './ports'
import { readPublicView, type ViewDeps } from './public-view'
import { refreshEntries } from './refresh'

type WriteDeps = Pick<
  Deps,
  'nodes' | 'facts' | 'topics' | 'work' | 'reference' | 'publicViews' | 'reviewQueue' | 'clock' | 'ids'
>

/**
 * Ensures the entry node exists, is marked as a seed entry when asked, and its `entry` fact is
 * live. The mark comes before the fact, so a new seed entry is never claimable unmarked. Converges
 * on retry.
 */
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
  if (input.seed) await deps.work.markSeed(entry.id)
  const { fact } = await submitFact(deps, actor, { kind: 'entry', subject_id: entry.id, payload: {} })
  return { entry, fact, created: entry.id === draft.id }
}

/**
 * Creates entries for the next `limit` headwords of the CEFR profiles that no entry has yet,
 * lowest level first, as seed entries the actor creates. Each goes through `createEntry`, so its
 * entry fact is reviewed like any other. Single letters other than "a" and "I" are skipped and
 * listed. Repeating it continues where the last call stopped and creates nothing once done.
 */
export async function importCoreEntries(
  deps: WriteDeps,
  actor: Actor,
  limit: number,
): Promise<{ created: Lemma[]; skipped: Lemma[]; remaining: number }> {
  const missing = await deps.reference.listCefrLemmasWithoutEntry()
  const core = missing.filter((lemma) => !isLetterOfTheAlphabet(lemma))
  const next = core.slice(0, limit)
  const created: Lemma[] = []
  for (const lemma of next) {
    if ((await createEntry(deps, actor, { lemma, seed: true })).created) created.push(lemma)
  }
  return {
    created,
    skipped: missing.filter(isLetterOfTheAlphabet),
    remaining: core.length - next.length,
  }
}

/**
 * Creates a sense with its gloss fact atomically. Idempotent by (entry, POS, gloss): the register
 * is a label, not part of the sense's identity, so the same gloss with any register returns the
 * existing sense unchanged. A register for an existing sense goes in a correction of its gloss.
 */
export async function createSense(
  deps: WriteDeps,
  actor: Actor,
  input: CreateSenseInput,
): Promise<{ sense: SenseNode; fact: Fact; created: boolean }> {
  const entry = await deps.nodes.findEntry(input.entry_id)
  if (!entry) throw new InvalidReferenceError(`Entry ${input.entry_id} does not exist.`)

  const payload = { gloss: input.gloss, register: input.register }
  const labellings = [undefined, ...registerSchema.options].map((register) =>
    contentKeyOf('sense', { gloss: input.gloss, register }),
  )
  const existing = await deps.nodes.findSenseByGloss(entry.id, input.pos, labellings)
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
    contentKey: contentKeyOf('sense', payload),
    payload,
    status: 'pending',
    supersedesId: null,
    author,
    review: null,
    revalidateSince: null,
    createdAt: now,
    updatedAt: now,
  }
  const stored = await deps.nodes.insertSenseWithFact(sense, fact, meaningKeyOf('sense', payload))
  const created = stored.sense.id === sense.id
  await refreshEntries(deps, [entry.id])
  if (created) await deps.reviewQueue.enqueue([{ factId: fact.id, traceId: actor.traceId }])
  return { ...stored, created }
}

/** The entry with its imported reference data, which is keyed by the entry's exact lemma. */
async function snapshotOf(
  deps: Pick<Deps, 'nodes' | 'reference'>,
  lemma: string,
): Promise<{ snapshot: EntrySnapshot; reference: LemmaReference }> {
  const entry = await deps.nodes.findEntryByLemma(normalizeTerm(lemma))
  if (!entry) throw new NotFoundError(`No entry for ${JSON.stringify(lemma)}.`)
  const [snapshot, reference] = await Promise.all([
    deps.nodes.loadEntrySnapshot(entry),
    deps.reference.forLemma(entry.lemma),
  ])
  return { snapshot, reference }
}

/** The entry's public document as stored, rebuilt first when stale. Exact lemma only. */
export async function getPublicEntry(deps: ViewDeps, lemma: string): Promise<StoredView> {
  const view = await readPublicView(deps, () => deps.publicViews.findByLemma(normalizeTerm(lemma)))
  if (!view) throw new NotFoundError(`No entry for ${JSON.stringify(lemma)}.`)
  return view
}

/** One public sense with its entry, and the digest of the entry document it comes from. */
export async function getPublicSense(
  deps: ViewDeps,
  id: SenseId,
): Promise<{ sense: PublicSenseWithEntry; digest: string }> {
  const view = await readPublicView(deps, () => deps.publicViews.findBySense(id))
  const sense = view && publicSenseOf(readDocument(view.json), id)
  if (!view || !sense) throw new NotFoundError(`Sense ${id} not found.`)
  return { sense, digest: view.digest }
}

/**
 * Exact match on a published form, with the digests of the entry documents the matches come
 * from. No fuzzy or lemma fallback: no match is not found.
 */
export async function lookupForm(
  deps: Pick<Deps, 'publicViews'>,
  form: string,
): Promise<{ matches: FormMatch[]; digests: string[] }> {
  const keys = formTypeSchema.options.map((type) => contentKeyOf('form', { form, type }))
  const found = await deps.publicViews.findForms(keys)
  if (found.length === 0) throw new NotFoundError(`No entry has the form ${JSON.stringify(form)}.`)
  return {
    matches: found.map(({ view, factId }) => formMatchOf(readDocument(view.json), factId)),
    digests: [...new Set(found.map(({ view }) => view.digest))],
  }
}

export function searchEntries(deps: Pick<Deps, 'publicViews'>, prefix: string, page: PageRequest) {
  return deps.publicViews.listEntries(normalizeTerm(prefix), page)
}

export function listEntrySummaries(deps: Pick<Deps, 'nodes'>, prefix: string, page: PageRequest) {
  return deps.nodes.listEntrySummaries(normalizeTerm(prefix), page)
}

export async function getManagedEntry(
  deps: Pick<Deps, 'nodes' | 'reference'>,
  lemma: string,
): Promise<ManagedEntryView & LemmaReference> {
  const { snapshot, reference } = await snapshotOf(deps, lemma)
  return { ...managedEntryView(snapshot), ...reference }
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
