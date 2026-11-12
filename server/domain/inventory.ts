import type { FactStatus, SenseId, StoredInventorySense } from '@shared/facts'
import { type Fact, type FactOf, isKind } from './fact'
import { isLive } from './fact-lifecycle'

/**
 * The entry's sense inventory among the facts `counts` counts: the `senses` fact that no counted
 * correction supersedes, so a pending correction stands for the published inventory it would
 * replace. Null while the entry has none.
 */
export function currentInventory(
  facts: readonly Fact[],
  counts: (status: FactStatus) => boolean = isLive,
): FactOf<'senses'> | null {
  const counted = facts.filter(isKind('senses')).filter((fact) => counts(fact.status))
  return counted.find((fact) => !counted.some((other) => other.supersedesId === fact.id)) ?? null
}

/** The senses an inventory lists, in its order: common first. */
export const inventorySenses = (inventory: FactOf<'senses'> | null): readonly StoredInventorySense[] =>
  inventory?.payload.senses ?? []

/** The common senses of an inventory, in its order. */
export const commonSenses = (inventory: FactOf<'senses'> | null): readonly StoredInventorySense[] =>
  inventorySenses(inventory).filter((sense) => sense.rank === 'common')

/** The ids an inventory lists. */
export const inventoryIds = (inventory: FactOf<'senses'> | null): SenseId[] =>
  inventorySenses(inventory).map((sense) => sense.id)

/** Whether the entry's inventory is published: after that only a curator changes its senses. */
export const inventorySettled = (facts: readonly Fact[]): boolean =>
  currentInventory(facts, (status) => status === 'published') !== null
