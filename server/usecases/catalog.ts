import {
  type EntrySnapshot,
  type ManagedEntryView,
  managedEntryView,
  type StoredEntry,
} from '@server/domain/catalog-view'
import { britishSpelling, filterHeadwords, type HeadwordFilter, regularBases } from '@server/domain/headword-import'
import type { EntryNode } from '@server/domain/nodes'
import { principalRef } from '@server/domain/principal'
import {
  ENGLISH_SCOPE,
  formMatches,
  type ReadVariant,
  readStored,
  shapeEntry,
  shapeOverview,
  shapeSenseDetail,
  shapeSenseSummary,
  shapeSentence,
  shapeSummary,
  type TopicCategories,
  topicCategories,
} from '@server/domain/public-view'
import { searchTerms } from '@server/domain/search'
import { type Lemma, normalizeTerm } from '@server/domain/term'
import type {
  CreateEntryInput,
  EntryOverview,
  EntrySort,
  FormMatch,
  Member,
  NodeLocation,
  PublicEntry,
  PublicSenseDetail,
  PublicSentence,
  SearchHit,
  WordSummary,
} from '@shared/catalog'
import type { EntryId, Pos, RelationDomain, SenseId, SentenceId, TopicId } from '@shared/facts'
import type { CefrLevel, LemmaReference } from '@shared/reference'
import { requireCurator } from './access'
import type { Deps } from './deps'
import { ConflictError, NotFoundError } from './errors'
import { type Actor, submitFact } from './facts'
import type { EntrySummaryFilter, Page, PageRequest } from './ports'
import { readPublicView, type ViewDeps } from './public-view'
import { refreshEntries } from './refresh'
import { leavesOf } from './topics'

type WriteDeps = Pick<
  Deps,
  'nodes' | 'facts' | 'topics' | 'work' | 'reference' | 'publicViews' | 'media' | 'reviewQueue' | 'clock' | 'ids'
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
  const reopened = await deps.work.reopenBlocked(lemmas)
  await refreshEntries(deps, [...entries.map((entry) => entry.id), ...reopened])
  return entries
}

/**
 * Admits the next `limit` headwords of the CEFR profiles that no entry has yet, lowest level
 * first, as batch 1, after the import filter (`filterHeadwords`): what it skipped is reported by
 * rule, and an American spelling merged into a British headword this call creates is recorded on
 * it as a curated variant form. Repeating it continues where the last call stopped and admits
 * nothing once done.
 */
export async function importCoreEntries(
  deps: WriteDeps,
  actor: Actor,
  limit: number,
): Promise<{ created: Lemma[]; skipped: HeadwordFilter['skipped']; remaining: number }> {
  requireCurator(actor.principal)
  const missing = await deps.reference.listCefrLemmasWithoutEntry()
  // Every candidate is a CEFR headword, so the list lists each; only the bases and British
  // spellings are looked up among the entries.
  const related = [...new Set(missing.flatMap((lemma) => [...regularBases(lemma), britishSpelling(lemma) ?? []]))]
  const entries = new Set<string>(
    (await deps.nodes.findEntriesByLemmas(related as Lemma[])).map((entry) => entry.lemma),
  )
  const { admit, skipped } = filterHeadwords(missing, { isEntry: (lemma) => entries.has(lemma), listed: () => true })
  const next = admit.slice(0, limit)
  const admitted = await admitHeadwords(deps, actor, next, CORE_BATCH)
  for (const { lemma, of } of skipped.variants) {
    const british = admitted.find((entry) => entry.lemma === of)
    if (!british) continue
    await submitFact(deps, actor, {
      kind: 'form',
      subject_id: british.id,
      payload: { form: lemma, type: 'variant' },
      curation: { reason: `The import merged the American spelling ${JSON.stringify(lemma)} into this entry.` },
    })
  }
  return { created: next, skipped, remaining: admit.length - next.length }
}

/** Takes an admitted entry off the wordlist: it stops being live, so it has no work and shows nowhere. */
export async function retireEntry(
  deps: WriteDeps,
  actor: Actor,
  id: EntryId,
): Promise<{ entry: EntryNode; retired: boolean }> {
  requireCurator(actor.principal)
  const entry = await deps.nodes.findEntry(id)
  if (!entry) throw new NotFoundError(`Entry ${id} not found.`)
  const lists = await deps.nodes.listNamingLists(id)
  if (lists.length > 0) {
    throw new ConflictError(
      `A published phrases list (${lists.join(', ')}) names ${JSON.stringify(entry.lemma)} as a phrase; correct that list instead.`,
    )
  }
  if (!(await deps.nodes.admission(id)).live) return { entry, retired: false }
  await deps.nodes.setPhrasesLive([], [id], null)
  await refreshEntries(deps, [id])
  return { entry, retired: true }
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
  deps: ViewDeps & Pick<Deps, 'mediaBaseUrl'>,
  lemma: string,
  variant: ReadVariant,
): Promise<VersionedRead<PublicEntry>> {
  const found = await readPublicView(deps, () => deps.publicViews.findByLemma(normalizeTerm(lemma)))
  if (!found) throw new NotFoundError(`No entry for ${JSON.stringify(lemma)}.`)
  const { view, links } = found
  const taxonomy = await taxonomyOf(deps)
  return {
    versions: [view.digest, JSON.stringify(links), taxonomy.version, deps.mediaBaseUrl],
    read: () => shapeEntry(readStored<StoredEntry>(view.json), links, deps.mediaBaseUrl, variant, taxonomy.categories),
  }
}

/**
 * The category of every leaf topic as the taxonomy has it now, which a read joins to the topic
 * tags it shows, and a version of it for the read's ETag: the document does not store categories.
 */
async function taxonomyOf(deps: Pick<Deps, 'topics'>): Promise<{ categories: TopicCategories; version: string }> {
  const categories = topicCategories(await deps.topics.list())
  return { categories, version: JSON.stringify([...categories]) }
}

/** One public sense in the requested variant, with its entry's summary. */
export async function getPublicSense(
  deps: ViewDeps & Pick<Deps, 'mediaBaseUrl'>,
  id: SenseId,
  variant: ReadVariant,
): Promise<VersionedRead<PublicSenseDetail>> {
  const found = await readPublicView(deps, () => deps.publicViews.findBySense(id))
  const taxonomy = await taxonomyOf(deps)
  const sense =
    found &&
    shapeSenseDetail(readStored<StoredEntry>(found.view.json), id, deps.mediaBaseUrl, variant, taxonomy.categories)
  if (!found || !sense) throw new NotFoundError(`Sense ${id} not found.`)
  return { versions: [found.view.digest, taxonomy.version, deps.mediaBaseUrl], read: () => sense }
}

/**
 * A public sentence: a published example of a public sense, or a saying of a public headword's
 * published phrases list. What it shows is read from those public documents, so it never says more
 * than they do; anything else is not found.
 */
export async function getPublicSentence(
  deps: ViewDeps,
  id: SentenceId,
  variant: ReadVariant,
): Promise<VersionedRead<PublicSentence>> {
  const sentence = await deps.nodes.findSentence(id)
  if (!sentence) throw new NotFoundError(`Sentence ${id} not found.`)
  const uses = await deps.nodes.listSentenceUses(id)
  const versions: string[] = []
  const examplesOf: Array<{ lemma: string; sense_id: SenseId }> = []
  const sayingOf: string[] = []
  let translations: Record<string, string> | null = null
  let meaning: string | null = null
  for (const use of uses.examples.filter((example) => example.status === 'published')) {
    const found = await readPublicView(deps, () => deps.publicViews.findBySense(use.senseId))
    const document = found && readStored<StoredEntry>(found.view.json)
    const sense = document?.meanings.flatMap((item) => item.senses).find((candidate) => candidate.id === use.senseId)
    const example = sense?.examples.find((candidate) => candidate.sentence_id === id)
    if (!found || !document || !sense || !example) continue
    versions.push(found.view.digest)
    examplesOf.push({ lemma: document.lemma, sense_id: sense.id })
    translations ??= example.translations
  }
  for (const use of uses.sayings.filter((saying) => saying.status === 'published')) {
    const found = await readPublicView(deps, () => deps.publicViews.findByLemma(use.lemma))
    const document = found && readStored<StoredEntry>(found.view.json)
    const saying = document?.sayings.find((candidate) => candidate.sentence_id === id)
    if (!found || !document || !saying || sayingOf.includes(document.lemma)) continue
    versions.push(found.view.digest)
    sayingOf.push(document.lemma)
    translations ??= saying.translations
    meaning ??= saying.meaning
  }
  if (versions.length === 0) throw new NotFoundError(`Sentence ${id} not found.`)
  const record = {
    id,
    text: sentence.text,
    source: sentence.source,
    meaning,
    translations: translations ?? {},
    examplesOf,
    sayingOf,
  }
  return { versions, read: () => shapeSentence(record, variant) }
}

/**
 * The members of a public sense taken as a category: every public sense whose broader terms lead
 * up to it, in the everyday layer and, when asked, the domain's, each once at its nearest depth. A
 * sense that is not public is not found.
 */
export async function listSenseMembers(
  deps: ViewDeps & Pick<Deps, 'mediaBaseUrl'>,
  id: SenseId,
  domain: RelationDomain | null,
  page: PageRequest,
  variant: ReadVariant,
): Promise<Page<Member> & { total: number }> {
  const found = await readPublicView(deps, () => deps.publicViews.findBySense(id))
  const document = found && readStored<StoredEntry>(found.view.json)
  const isPublic = document?.meanings.some((meaning) => meaning.senses.some((sense) => sense.id === id))
  if (!isPublic) throw new NotFoundError(`Sense ${id} not found.`)
  const members = await deps.publicViews.listMembers(id, domain, page)
  return {
    ...members,
    items: members.items.map(({ summary, depth, parents }) => ({
      ...shapeSenseSummary(summary, deps.mediaBaseUrl, variant),
      depth,
      parents,
    })),
  }
}

/**
 * The overviews of the public entries spelled exactly as these lemmas, in the order asked, each
 * once, and the lemmas with no public entry. Read from the built views as lists are; a lemma that
 * matches no entry exactly is missing, never matched by another spelling. Versioned by the digest
 * of each document found and by what is missing, so an unchanged answer revalidates without a body.
 */
export async function listEntryOverviews(
  deps: Pick<Deps, 'publicViews' | 'mediaBaseUrl'>,
  lemmas: readonly string[],
  senses: number,
  variant: ReadVariant,
): Promise<VersionedRead<{ items: EntryOverview[]; missing: string[] }>> {
  const asked = new Map(lemmas.map((lemma) => [normalizeTerm(lemma), lemma]))
  const views = await deps.publicViews.findDocuments([...asked.keys()])
  const found = views.map((view) => ({ view, document: readStored<StoredEntry>(view.json) }))
  const byLemma = new Map(found.map((item) => [item.document.lemma as string, item]))
  const inOrder = [...asked].map(([lemma, spelled]) => ({ spelled, found: byLemma.get(lemma) }))
  return {
    versions: [String(senses), ...inOrder.map((item) => item.found?.view.digest ?? `missing:${item.spelled}`)],
    read: () => ({
      items: inOrder.flatMap((item) => (item.found ? [shapeOverview(item.found.document, senses, variant)] : [])),
      missing: inOrder.flatMap((item) => (item.found ? [] : [item.spelled])),
    }),
  }
}

/**
 * Exact match on a published form: each entry with the form, as a summary with the forms that
 * matched. No fuzzy or lemma fallback: no match is not found.
 */
export async function lookupForm(
  deps: Pick<Deps, 'publicViews' | 'mediaBaseUrl'>,
  form: string,
  variant: ReadVariant,
): Promise<VersionedRead<FormMatch[]>> {
  const rows = await deps.publicViews.findForms(normalizeTerm(form))
  if (rows.length === 0) throw new NotFoundError(`No entry has the form ${JSON.stringify(form)}.`)
  return {
    versions: [...new Set(rows.map((row) => row.digest)), deps.mediaBaseUrl],
    read: () => formMatches(rows, deps.mediaBaseUrl, variant),
  }
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
  deps: Pick<Deps, 'publicViews' | 'topics' | 'mediaBaseUrl'>,
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
  return { ...found, items: found.items.map((summary) => shapeSummary(summary, deps.mediaBaseUrl, variant)) }
}

/**
 * Public entries matching a query: the exact lemma or a spelling variant of it, lemmas starting with it, then entries with a
 * gloss, a translation in the read's language, or an example holding every word of it. No typo
 * correction, stemming, or other fallback.
 */
export async function searchPublicEntries(
  deps: Pick<Deps, 'publicViews' | 'mediaBaseUrl'>,
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
  return {
    ...found,
    items: found.items.map((row) => ({ ...shapeSummary(row.summary, deps.mediaBaseUrl, variant), match: row.match })),
  }
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
