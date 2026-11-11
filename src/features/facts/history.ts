import type { FactDto } from '@shared/facts'

/**
 * The correction chain a fact belongs to, newest first: the facts it supersedes, back to the
 * first, and the facts that supersede it, from the entry's facts.
 */
export function correctionChain(fact: FactDto, facts: readonly FactDto[]): FactDto[] {
  const byId = new Map(facts.map((candidate) => [candidate.id, candidate]))
  byId.set(fact.id, fact)
  const chain = new Map<string, FactDto>([[fact.id, fact]])
  let back = fact.supersedes_id ? byId.get(fact.supersedes_id) : undefined
  while (back && !chain.has(back.id)) {
    chain.set(back.id, back)
    back = back.supersedes_id ? byId.get(back.supersedes_id) : undefined
  }
  let grew = true
  while (grew) {
    grew = false
    for (const candidate of byId.values()) {
      if (!chain.has(candidate.id) && candidate.supersedes_id && chain.has(candidate.supersedes_id)) {
        chain.set(candidate.id, candidate)
        grew = true
      }
    }
  }
  return [...chain.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
}
