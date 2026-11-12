import type { EntryId, Pos, Region, Register, SenseId } from '@shared/facts'
import type { CefrLevel } from '@shared/reference'
import { type EntrySnapshot, type ManagedEntryView, managedEntryView } from './catalog-view'
import { type Fact, isKind } from './fact'
import { currentInventory, inventorySenses } from './inventory'
import type { TopicView } from './topics'
import { WORK_POLICY, type WorkItem } from './work'
import { type WorkCriteria, workCriteria } from './work-criteria'

/** A sense of the entry as a worker reads it: its gloss in the live inventory and whether it ranks extra. */
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
  /** Its gloss while it can show (a live entry's published inventory lists it); null when it cannot. */
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
  /** The facts earlier passes submitted for the item that review rejected, newest first. */
  rejections: Fact[]
  related: RelatedContextSense[]
  view: ManagedEntryView | null
  /** The standard the reviewers judge the item's facts by. */
  criteria: WorkCriteria
}

/** How many rejected facts a retry reads: enough to see every reason of the last passes. */
export const REJECTIONS_SHOWN = 10

/**
 * The context of a claimed item, cut from its entry's snapshot: the entry and the senses of its
 * live inventory in its order, the sense the item is about, every fact about the item's node in
 * every status with the senses at the other end of its relations, the rejected facts an earlier
 * pass submitted for it, and the whole management view for the types the policy gives whole-entry
 * context.
 */
export function workContext(
  item: WorkItem,
  snapshot: EntrySnapshot,
  reference: { cefr: ReadonlyArray<{ pos: Pos; level: CefrLevel }> },
  taxonomy: readonly TopicView[],
): WorkContext {
  const all = [...snapshot.facts, ...snapshot.incoming]
  const inventory = currentInventory(snapshot.facts)
  const status = inventory?.status === 'published' ? 'published' : 'pending'
  const senses = inventorySenses(inventory).map(
    (sense): ContextSense => ({
      id: sense.id,
      pos: sense.pos,
      gloss: sense.gloss,
      register: sense.register ?? null,
      region: sense.region ?? null,
      rare: sense.rank === 'extra',
      status,
    }),
  )
  const node = item.subjectId
  const entryWide = node === snapshot.entry.id
  const facts = all.filter((fact) => fact.subjectId === node || fact.objectId === node)

  // A relation links senses of two entries, so its other end is always among the neighbors.
  const neighborSenses = new Map<SenseId, { lemma: string; pos: Pos; gloss: string | null }>()
  const byEntry = new Map<EntryId, Fact[]>()
  for (const fact of snapshot.neighbors.inventories) {
    byEntry.set(fact.subjectId as EntryId, [...(byEntry.get(fact.subjectId as EntryId) ?? []), fact])
  }
  for (const [entryId, inventories] of byEntry) {
    const lemma = snapshot.neighbors.lemmas.get(entryId) ?? ''
    const shown = new Set(
      snapshot.neighbors.liveEntries.has(entryId)
        ? inventorySenses(currentInventory(inventories, (fact) => fact === 'published')).map((sense) => sense.id)
        : [],
    )
    for (const sense of inventorySenses(currentInventory(inventories))) {
      neighborSenses.set(sense.id, { lemma, pos: sense.pos, gloss: shown.has(sense.id) ? sense.gloss : null })
    }
  }
  for (const sense of senses) neighborSenses.set(sense.id, { lemma: snapshot.entry.lemma, pos: sense.pos, gloss: sense.gloss })
  const ends = new Set(
    facts
      .filter(isKind('relation'))
      .flatMap((fact) => [fact.subjectId, fact.payload.target_sense_id])
      .filter((id) => id !== node),
  )
  const related = [...ends].flatMap((id): RelatedContextSense[] => {
    const sense = neighborSenses.get(id)
    return sense ? [{ senseId: id, lemma: sense.lemma, pos: sense.pos, gloss: sense.gloss }] : []
  })

  const sense = senses.find((candidate) => candidate.id === node) ?? null
  const criteria = workCriteria(item.gap, sense?.pos ?? null, taxonomy)
  const fillKinds = new Set(criteria.fills.map((fill) => fill.kind))
  const rejections = all
    .filter((fact) => fact.status === 'rejected' && fillKinds.has(fact.kind))
    .filter((fact) => entryWide || fact.subjectId === node || fact.objectId === node)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, REJECTIONS_SHOWN)
  return {
    entry: {
      id: snapshot.entry.id,
      lemma: snapshot.entry.lemma,
      cefr: reference.cefr.map(({ pos, level }) => ({ pos, level })),
      zipf: snapshot.zipf,
      senses,
    },
    sense,
    facts,
    rejections,
    related,
    view: WORK_POLICY[item.type].context === 'entry' ? managedEntryView(snapshot) : null,
    criteria,
  }
}
