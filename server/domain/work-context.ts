import type { EntryId, Pos, Region, Register, SenseId } from '@shared/facts'
import type { CefrLevel } from '@shared/reference'
import { type EntrySnapshot, type ManagedEntryView, managedEntryView } from './catalog-view'
import { currentGloss, type Fact, type FactOf, isKind } from './fact'
import { isLive } from './fact-lifecycle'
import { currentSenseList, listedSenses } from './sense-list'
import { WORK_POLICY, type WorkItem } from './work'

/** A sense of the entry as a worker reads it: its current gloss and whether its list calls it rare. */
export interface ContextSense {
  id: SenseId
  pos: Pos
  gloss: string
  register: Register | null
  region: Region | null
  rare: boolean
  status: 'pending' | 'published'
}

/** A sense at the other end of a relation among the context facts. */
export interface RelatedContextSense {
  senseId: SenseId
  lemma: string
  pos: Pos
  /** Its current gloss while it can show (a live gloss and a live entry fact); null when it cannot. */
  gloss: string | null
}

/** What a claimed item carries so a worker needs no further read for it. */
export interface WorkContext {
  entry: {
    id: EntryId
    lemma: string
    cefr: Array<{ pos: Pos; level: CefrLevel }>
    zipf: number | null
    senses: ContextSense[]
  }
  sense: ContextSense | null
  facts: Fact[]
  related: RelatedContextSense[]
  view: ManagedEntryView | null
}

/** The current gloss of each sense with a live one. */
function glossesOf(facts: readonly Fact[]): Map<string, FactOf<'sense'>> {
  const live = facts.filter(isKind('sense')).filter((fact) => isLive(fact.status))
  const senses = new Set(live.map((fact) => fact.subjectId))
  // Each sense here has at least the live gloss that put it in the set.
  return new Map(
    [...senses].map((id) => {
      const [first, ...rest] = live.filter((fact) => fact.subjectId === id) as [FactOf<'sense'>, ...FactOf<'sense'>[]]
      return [id, currentGloss([first, ...rest])] as const
    }),
  )
}

/**
 * The node an item's facts are about: the sense or entry it names, or for a weak fact the node that
 * fact is about.
 */
function nodeOf(item: WorkItem, facts: readonly Fact[]): string {
  if (!('fact_id' in item.gap)) return item.subjectId
  const { fact_id: id } = item.gap
  const fact = facts.find((candidate) => candidate.id === id)
  if (!fact) throw new Error(`Weak fact ${id} of item ${item.id} is not in its entry's snapshot.`)
  return fact.subjectId
}

/**
 * The context of a claimed item, cut from its entry's snapshot: the entry and its senses with
 * their current glosses (common senses first, in the list's order), the sense the item is about,
 * every fact about the item's node in every status with the senses at the other end of its
 * relations, and the whole management view for the types the policy gives whole-entry context.
 */
export function workContext(
  item: WorkItem,
  snapshot: EntrySnapshot,
  reference: { cefr: ReadonlyArray<{ pos: Pos; level: CefrLevel }> },
): WorkContext {
  const all = [...snapshot.facts, ...snapshot.incoming]
  const glosses = glossesOf(snapshot.facts)
  const list = currentSenseList(snapshot.facts)
  const extra = new Set(list?.payload.extra)
  const listed = list ? listedSenses(list.payload) : []
  const order = (id: SenseId) => (listed.includes(id) ? listed.indexOf(id) : listed.length)
  const senses = snapshot.senses
    .flatMap((sense): ContextSense[] => {
      const gloss = glosses.get(sense.id)
      if (!gloss) return []
      const status = gloss.status === 'published' ? 'published' : 'pending'
      return [
        {
          id: sense.id,
          pos: sense.pos,
          gloss: gloss.payload.gloss,
          register: gloss.payload.register ?? null,
          region: gloss.payload.region ?? null,
          rare: extra.has(sense.id),
          status,
        },
      ]
    })
    .sort((a, b) => order(a.id) - order(b.id))
  const node = nodeOf(item, all)
  const facts = all.filter((fact) => fact.subjectId === node || fact.objectId === node)
  // A relation links senses of two entries, so its other end is always among the neighbors.
  const neighborGlosses = glossesOf(snapshot.neighbors.facts)
  const liveEntries = new Set(
    snapshot.neighbors.facts
      .filter(isKind('entry'))
      .filter((fact) => isLive(fact.status))
      .map((fact) => fact.subjectId),
  )
  const neighbors = new Map(snapshot.neighbors.senses.map((sense) => [sense.id, sense]))
  const ends = new Set(
    facts
      .filter(isKind('relation'))
      .flatMap((fact) => [fact.subjectId, fact.payload.target_sense_id])
      .filter((id) => id !== node),
  )
  const related = [...ends].map((id): RelatedContextSense => {
    const sense = neighbors.get(id)
    if (!sense) throw new Error(`Relation end ${id} of item ${item.id} is not among its entry's neighbors.`)
    return {
      senseId: sense.id,
      lemma: sense.lemma,
      pos: sense.pos,
      // A sense that cannot show fills no gap, so a worker never reads it as a live end.
      gloss: liveEntries.has(sense.entryId) ? (neighborGlosses.get(id)?.payload.gloss ?? null) : null,
    }
  })
  return {
    entry: {
      id: snapshot.entry.id,
      lemma: snapshot.entry.lemma,
      cefr: reference.cefr.map(({ pos, level }) => ({ pos, level })),
      zipf: snapshot.zipf,
      senses,
    },
    sense: senses.find((sense) => sense.id === node) ?? null,
    facts,
    related,
    view: WORK_POLICY[item.type].context === 'entry' ? managedEntryView(snapshot) : null,
  }
}
