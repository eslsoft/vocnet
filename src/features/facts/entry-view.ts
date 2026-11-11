import type { managedEntrySchema } from '@shared/catalog'
import type { FactDto } from '@shared/facts'
import type { z } from 'zod'

type ManagedEntry = z.infer<typeof managedEntrySchema>
type SenseNode = ManagedEntry['senses'][number]

/** Where the entry's sense list puts a sense: its rank among the common senses, extra, or not named. */
export type Listing = { rank: number } | 'extra' | 'unlisted'

export interface SenseView {
  sense: SenseNode
  /** The published gloss, or until one publishes, the pending one. */
  gloss: string | null
  /** Null while the entry has no live sense list. */
  listing: Listing | null
  facts: FactDto[]
  /** Relations from other entries' senses that point at this sense. */
  incoming: FactDto[]
}

const isLive = (fact: FactDto) => fact.status === 'pending' || fact.status === 'published'

function liveGloss(facts: FactDto[]): string | null {
  const glossOf = (status: FactDto['status']) => {
    const fact = facts.find((candidate) => candidate.kind === 'sense' && candidate.status === status)
    return fact?.kind === 'sense' ? fact.payload.gloss : undefined
  }
  return glossOf('published') ?? glossOf('pending') ?? null
}

/** The live sense list that no live correction supersedes, as the worklist reads it. */
function currentSenseList(entryFacts: FactDto[]) {
  const live = entryFacts.filter(isLive)
  const list = live.find((fact) => fact.kind === 'sense_list' && !live.some((other) => other.supersedes_id === fact.id))
  return list?.kind === 'sense_list' ? list.payload : null
}

/**
 * Groups the management view's flat fact list by the node each fact is about. With a sense list,
 * the senses follow it: common by rank, then extra, then the senses it does not name.
 */
export function groupEntry(view: ManagedEntry): { entryFacts: FactDto[]; senses: SenseView[] } {
  const ownIds = new Set<string>([view.entry.id, ...view.senses.map((sense) => sense.id)])
  const about = (id: string) => view.facts.filter((fact) => fact.subject_id === id)
  const entryFacts = about(view.entry.id)
  const list = currentSenseList(entryFacts)
  const listed: Array<SenseNode['id']> = list ? [...list.common, ...list.extra] : []
  const listingOf = (id: SenseNode['id']): Listing | null => {
    if (!list) return null
    const rank = list.common.indexOf(id)
    if (rank >= 0) return { rank: rank + 1 }
    return list.extra.includes(id) ? 'extra' : 'unlisted'
  }
  const position = (id: SenseNode['id']) => (listed.includes(id) ? listed.indexOf(id) : listed.length)
  const senses = [...view.senses].sort((a, b) => position(a.id) - position(b.id))
  return {
    entryFacts,
    senses: senses.map((sense) => {
      const facts = about(sense.id)
      return {
        sense,
        gloss: liveGloss(facts),
        listing: listingOf(sense.id),
        facts,
        incoming: view.facts.filter((fact) => fact.object_id === sense.id && !ownIds.has(fact.subject_id)),
      }
    }),
  }
}
