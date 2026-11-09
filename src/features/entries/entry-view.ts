import type { managedEntrySchema } from '@shared/catalog'
import type { FactDto } from '@shared/facts'
import type { z } from 'zod'

type ManagedEntry = z.infer<typeof managedEntrySchema>
type SenseNode = ManagedEntry['senses'][number]

export interface SenseView {
  sense: SenseNode
  /** The published gloss, or until one publishes, the pending one. */
  gloss: string | null
  facts: FactDto[]
  /** Relations from other entries' senses that point at this sense. */
  incoming: FactDto[]
}

function liveGloss(facts: FactDto[]): string | null {
  const glossOf = (status: FactDto['status']) => {
    const fact = facts.find((candidate) => candidate.kind === 'sense' && candidate.status === status)
    return fact?.kind === 'sense' ? fact.payload.gloss : undefined
  }
  return glossOf('published') ?? glossOf('pending') ?? null
}

/** Groups the management view's flat fact list by the node each fact is about. */
export function groupEntry(view: ManagedEntry): { entryFacts: FactDto[]; senses: SenseView[] } {
  const ownIds = new Set<string>([view.entry.id, ...view.senses.map((sense) => sense.id)])
  const about = (id: string) => view.facts.filter((fact) => fact.subject_id === id)
  return {
    entryFacts: about(view.entry.id),
    senses: view.senses.map((sense) => {
      const facts = about(sense.id)
      return {
        sense,
        gloss: liveGloss(facts),
        facts,
        incoming: view.facts.filter((fact) => fact.object_id === sense.id && !ownIds.has(fact.subject_id)),
      }
    }),
  }
}
