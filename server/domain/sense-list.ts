import type { FactPayloads, SenseId } from '@shared/facts'
import { type Fact, type FactOf, isKind } from './fact'
import { isLive } from './fact-lifecycle'

type SenseList = FactPayloads['sense_list']

/**
 * The entry's sense list: its live `sense_list` fact that no live correction supersedes, so a
 * pending correction stands for the published list it would replace.
 */
export function currentSenseList(facts: readonly Fact[]): FactOf<'sense_list'> | null {
  const live = facts.filter(isKind('sense_list')).filter((fact) => isLive(fact.status))
  return live.find((fact) => !live.some((other) => other.supersedesId === fact.id)) ?? null
}

/** Every sense a list names: common in order, then extra. */
export const listedSenses = ({ common, extra }: SenseList): SenseId[] => [...common, ...extra]

/**
 * A list settles the inventory while it names exactly these senses. A sense added since, or a
 * listed one whose gloss is no longer live, makes it stale. A list never names a sense twice.
 */
export function listsExactly(list: SenseList, senses: readonly SenseId[]): boolean {
  const listed = listedSenses(list)
  return listed.length === senses.length && senses.every((id) => listed.includes(id))
}
