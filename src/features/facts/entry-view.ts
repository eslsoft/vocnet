import type { managedEntrySchema } from '@shared/catalog'
import type { FactDto, StoredInventorySense } from '@shared/facts'
import type { z } from 'zod'

type ManagedEntry = z.infer<typeof managedEntrySchema>
type SenseNode = ManagedEntry['senses'][number]
export type InventoryFact = Extract<FactDto, { kind: 'senses' }>

export interface SenseView {
  sense: SenseNode
  /** The inventory's line for the sense: its gloss, labels, and rank; null when the inventory does not list it. */
  item: StoredInventorySense | null
  /** Facts about the sense, and the translations of its examples and collocations. */
  facts: FactDto[]
  /** Relations from other entries' senses that point at this sense. */
  incoming: FactDto[]
}

/** The inventory the entry shows: the published one, or until one publishes, the pending one. */
export function currentInventory(entryFacts: FactDto[]): InventoryFact | null {
  const inventories = entryFacts.filter((fact): fact is InventoryFact => fact.kind === 'senses')
  return (
    inventories.find((fact) => fact.status === 'published') ??
    inventories.find((fact) => fact.status === 'pending') ??
    null
  )
}

/**
 * Groups the management view's flat fact list by the node each fact is about. The senses follow
 * the current inventory's order; a sense it does not list comes last.
 */
export function groupEntry(view: ManagedEntry): {
  entryFacts: FactDto[]
  inventory: InventoryFact | null
  senses: SenseView[]
} {
  const ownIds = new Set<string>([view.entry.id, ...view.senses.map((sense) => sense.id)])
  const about = (id: string) => view.facts.filter((fact) => fact.subject_id === id)
  const entryFacts = about(view.entry.id)
  const inventory = currentInventory(entryFacts)
  const items = inventory?.payload.senses ?? []
  const position = (id: SenseNode['id']) => {
    const index = items.findIndex((item) => item.id === id)
    return index === -1 ? items.length : index
  }
  const senses = [...view.senses].sort((a, b) => position(a.id) - position(b.id))
  return {
    entryFacts,
    inventory,
    senses: senses.map((sense) => {
      const own = about(sense.id)
      return {
        sense,
        item: items.find((item) => item.id === sense.id) ?? null,
        facts: [...own, ...own.flatMap((fact) => about(fact.id))],
        incoming: view.facts.filter((fact) => fact.object_id === sense.id && !ownIds.has(fact.subject_id)),
      }
    }),
  }
}
