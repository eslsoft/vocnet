import {
  type EntrySnapshot,
  type ManagedEntryView,
  managedEntryView,
  type StoredEntry,
} from '@server/domain/catalog-view'
import type { Fact, FactOf } from '@server/domain/fact'
import { contentKeyOf, meaningKeyOf } from '@server/domain/fact-kinds'
import type { EntryNode, SenseNode } from '@server/domain/nodes'
import { principalRef } from '@server/domain/principal'
import {
  commonSenseIds,
  ENGLISH_SCOPE,
  formMatches,
  type ReadVariant,
  readStored,
  shapeEntry,
  shapeSenseDetail,
  shapeSenseSummary,
  shapeSummary,
} from '@server/domain/public-view'
import { searchTerms } from '@server/domain/search'
import { isLetterOfTheAlphabet, type Lemma, normalizeTerm } from '@server/domain/term'
import type {
  CreateEntryInput,
  CreateSenseInput,
  EntryMember,
  EntrySort,
  FormMatch,
  Member,
  NodeLocation,
  PublicEntry,
  PublicSenseDetail,
  SearchHit,
  Stats,
  WordSummary,
} from '@shared/catalog'
import type { EntryId, Pos, RelationDomain, SenseId, TopicId } from '@shared/facts'
import type { CefrLevel, LemmaReference } from '@shared/reference'
import type { Deps } from './deps'
import { InvalidReferenceError, NotFoundError } from './errors'
import { type Actor, submitFact } from './facts'
import type { Page, PageRequest } from './ports'
import { readPublicView, type ViewDeps } from './public-view'
import { refreshEntries } from './refresh'
import { leavesOf } from './topics'

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
 * and region are labels, not part of the sense's identity, so the same gloss with any labels
 * returns the existing sense unchanged. A label for an existing sense goes in a correction of its
 * gloss.
 */
export async function createSense(
  deps: WriteDeps,
  actor: Actor,
  input: CreateSenseInput,
): Promise<{ sense: SenseNode; fact: Fact; created: boolean }> {
  const entry = await deps.nodes.findEntry(input.entry_id)
  if (!entry) throw new InvalidReferenceError(`Entry ${input.entry_id} does not exist.`)

  const payload = { gloss: input.gloss, register: input.register, region: input.region }
  const existing = await deps.nodes.findSenseByGloss(entry.id, input.pos, meaningKeyOf('sense', payload))
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

/** A public read: what its ETag is computed over, and its body, built only when it is sent. */
export interface VersionedRead<T> {
  /** Changes whenever the body of any variant does. */
  versions: string[]
  read: () => T
}

/**
 * The entry's public document in the requested variant, rebuilt first when stale, with what other
 * entries supply joined in. Exact lemma only.
 */
export async function getPublicEntry(
  deps: ViewDeps,
  lemma: string,
  variant: ReadVariant,
): Promise<VersionedRead<PublicEntry>> {
  const found = await readPublicView(deps, () => deps.publicViews.findByLemma(normalizeTerm(lemma)))
  if (!found) throw new NotFoundError(`No entry for ${JSON.stringify(lemma)}.`)
  const { view, links } = found
  return {
    versions: [view.digest, JSON.stringify(links)],
    read: () => shapeEntry(readStored<StoredEntry>(view.json), links, variant),
  }
}

/** One public sense in the requested variant, with its entry's summary. */
export async function getPublicSense(
  deps: ViewDeps,
  id: SenseId,
  variant: ReadVariant,
): Promise<VersionedRead<PublicSenseDetail>> {
  const found = await readPublicView(deps, () => deps.publicViews.findBySense(id))
  const sense = found && shapeSenseDetail(readStored<StoredEntry>(found.view.json), id, variant)
  if (!found || !sense) throw new NotFoundError(`Sense ${id} not found.`)
  return { versions: [found.view.digest], read: () => sense }
}

/**
 * The members of a public sense taken as a category: every public sense whose broader terms lead
 * up to it, in the everyday layer and, when asked, the domain's, each once at its nearest depth. A
 * sense that is not public is not found.
 */
export async function listSenseMembers(
  deps: ViewDeps,
  id: SenseId,
  domain: RelationDomain | null,
  page: PageRequest,
  variant: ReadVariant,
): Promise<Page<Member>> {
  const found = await readPublicView(deps, () => deps.publicViews.findBySense(id))
  const sense = found && shapeSenseDetail(readStored<StoredEntry>(found.view.json), id, variant)
  if (!sense) throw new NotFoundError(`Sense ${id} not found.`)
  const members = await deps.publicViews.listMembers([id], domain, page)
  return {
    ...members,
    items: members.items.map(({ summary, depth }) => ({ ...shapeSenseSummary(summary, variant), depth })),
  }
}

/**
 * The members of a public entry taken as a category: the members of every common sense of the
 * exact lemma, of one part of speech or of all, each once at its nearest depth with the senses of
 * the entry it descends from, in the entry's order. An entry that is not public is not found; one
 * without a common sense of the part of speech has no members.
 */
export async function listEntryMembers(
  deps: ViewDeps,
  lemma: string,
  pos: Pos | null,
  domain: RelationDomain | null,
  page: PageRequest,
  variant: ReadVariant,
): Promise<Page<EntryMember>> {
  const found = await readPublicView(deps, () => deps.publicViews.findByLemma(normalizeTerm(lemma)))
  if (!found) throw new NotFoundError(`No entry for ${JSON.stringify(lemma)}.`)
  const roots = commonSenseIds(readStored<StoredEntry>(found.view.json), pos)
  const members = await deps.publicViews.listMembers(roots, domain, page)
  return {
    ...members,
    items: members.items.map(({ summary, depth, via }) => ({
      ...shapeSenseSummary(summary, variant),
      depth,
      via: roots.filter((root) => via.includes(root)),
    })),
  }
}

/**
 * Exact match on a published form: each entry with the form, as a summary with the forms that
 * matched. No fuzzy or lemma fallback: no match is not found.
 */
export async function lookupForm(
  deps: Pick<Deps, 'publicViews'>,
  form: string,
  variant: ReadVariant,
): Promise<VersionedRead<FormMatch[]>> {
  const rows = await deps.publicViews.findForms(normalizeTerm(form))
  if (rows.length === 0) throw new NotFoundError(`No entry has the form ${JSON.stringify(form)}.`)
  return { versions: [...new Set(rows.map((row) => row.digest))], read: () => formMatches(rows, variant) }
}

/** Which public entries a list shows; `topic` is a leaf topic or a category. */
export interface EntryListFilter {
  prefix: string
  levels: readonly CefrLevel[]
  pos: Pos | null
  topic: TopicId | null
}

/**
 * Public entries in lemma or frequency order, filtered by lemma prefix, and by a meaning (or with
 * a topic, a tagged sense) of the part of speech and levels asked. An unknown topic is not found.
 */
export async function listPublicEntries(
  deps: Pick<Deps, 'publicViews' | 'topics'>,
  filter: EntryListFilter,
  sort: EntrySort,
  page: PageRequest,
  variant: ReadVariant,
): Promise<Page<WordSummary>> {
  const leaves = filter.topic === null ? null : await leavesOf(deps, filter.topic)
  const found = await deps.publicViews.listEntries(
    { prefix: normalizeTerm(filter.prefix), levels: filter.levels, pos: filter.pos, leaves },
    sort,
    page,
  )
  return { ...found, items: found.items.map((summary) => shapeSummary(summary, variant)) }
}

/**
 * Public entries matching a query: the exact lemma or a spelling variant of it, lemmas starting with it, then entries with a
 * gloss, a translation in the read's language, or an example holding every word of it. No typo
 * correction, stemming, or other fallback.
 */
export async function searchPublicEntries(
  deps: Pick<Deps, 'publicViews'>,
  text: string,
  page: PageRequest,
  variant: ReadVariant,
): Promise<Page<SearchHit>> {
  if (variant.lang === 'all') throw new Error('A search reads one language or none.')
  const query = normalizeTerm(text)
  const found = await deps.publicViews.search(
    {
      text: query,
      terms: searchTerms(query),
      scopes: [ENGLISH_SCOPE, ...(variant.lang === null ? [] : [variant.lang])],
    },
    page,
  )
  return { ...found, items: found.items.map((row) => ({ ...shapeSummary(row.summary, variant), match: row.match })) }
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
