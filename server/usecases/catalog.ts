import {
  type EntrySnapshot,
  type ManagedEntryView,
  managedEntryView,
  type StoredEntry,
} from '@server/domain/catalog-view'
import type { EntryNode } from '@server/domain/nodes'
import { principalRef } from '@server/domain/principal'
import {
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
  EntrySort,
  FormMatch,
  Member,
  NodeLocation,
  PublicEntry,
  PublicSenseDetail,
  SearchHit,
  WordSummary,
} from '@shared/catalog'
import type { EntryId, Pos, RelationDomain, SenseId, TopicId } from '@shared/facts'
import type { CefrLevel, LemmaReference } from '@shared/reference'
import type { Deps } from './deps'
import { requireCurator } from './access'
import { NotFoundError } from './errors'
import type { Actor } from './facts'
import type { EntrySummaryFilter, Page, PageRequest } from './ports'
import { readPublicView, type ViewDeps } from './public-view'
import { refreshEntries } from './refresh'
import { leavesOf } from './topics'

type WriteDeps = Pick<
  Deps,
  'nodes' | 'facts' | 'topics' | 'work' | 'reference' | 'publicViews' | 'reviewQueue' | 'clock' | 'ids'
>

/**
 * Admits one lemma as a headword of the batch: its entry exists and is live from now on. Curators
 * only; agents never create entries. Importing a word reopens the slots passes were blocked on it.
 */
export async function createEntry(
  deps: WriteDeps,
  actor: Actor,
  input: CreateEntryInput,
): Promise<{ entry: EntryNode; created: boolean }> {
  requireCurator(actor.principal)
  const lemma = normalizeTerm(input.lemma)
  const existing = await deps.nodes.findEntryByLemma(lemma)
  const [entry] = await admitHeadwords(deps, actor, [lemma], input.batch)
  if (!entry) throw new Error(`Admitting ${JSON.stringify(lemma)} stored no entry.`)
  return { entry, created: existing === null }
}

/** Admits the lemmas as headwords of the batch and reopens the slots passes were blocked on them. */
async function admitHeadwords(
  deps: WriteDeps,
  actor: Actor,
  lemmas: readonly Lemma[],
  batch: number,
): Promise<EntryNode[]> {
  const now = deps.clock.now().toISOString()
  const entries = await deps.nodes.admit(lemmas, batch, principalRef(actor.principal), now)
  await deps.work.reopenBlocked(lemmas)
  await refreshEntries(
    deps,
    entries.map((entry) => entry.id),
  )
  return entries
}

/**
 * Admits the next `limit` headwords of the CEFR profiles that no entry has yet, lowest level
 * first, as batch 1. Single letters other than "a" and "I" are skipped and listed. Repeating it
 * continues where the last call stopped and admits nothing once done.
 */
export async function importCoreEntries(
  deps: WriteDeps,
  actor: Actor,
  limit: number,
): Promise<{ created: Lemma[]; skipped: Lemma[]; remaining: number }> {
  requireCurator(actor.principal)
  const missing = await deps.reference.listCefrLemmasWithoutEntry()
  const core = missing.filter((lemma) => !isLetterOfTheAlphabet(lemma))
  const next = core.slice(0, limit)
  await admitHeadwords(deps, actor, next, CORE_BATCH)
  return { created: next, skipped: missing.filter(isLetterOfTheAlphabet), remaining: core.length - next.length }
}

/** The headword batch the CEFR profiles are. */
export const CORE_BATCH = 1

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
  const members = await deps.publicViews.listMembers(id, domain, page)
  return {
    ...members,
    items: members.items.map(({ summary, depth }) => ({ ...shapeSenseSummary(summary, variant), depth })),
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

/** Entries in lemma order, by lemma prefix, lowest CEFR level, a weak fact, or an item at the attempt bound. */
export function listEntrySummaries(deps: Pick<Deps, 'nodes' | 'clock'>, filter: EntrySummaryFilter, page: PageRequest) {
  return deps.nodes.listEntrySummaries(
    { ...filter, prefix: normalizeTerm(filter.prefix) },
    page,
    deps.clock.now().toISOString(),
  )
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
