import type { FactOf } from '@server/domain/fact'
import type { EntryNode } from '@server/domain/nodes'
import { createEntry } from '@server/usecases/catalog'
import { type Actor, submitFact } from '@server/usecases/facts'
import { reviewFact } from '@server/usecases/review'
import type { InventorySense, Pos, SenseId, SenseRank } from '@shared/facts'
import { admin, agentA } from './actors'
import type { FakeWorld } from './fakes'

/** Reviews every queued job, and the jobs those reviews queue, until the queue is empty. */
export async function drainReviews(world: FakeWorld): Promise<void> {
  for (let job = world.queued.shift(); job; job = world.queued.shift()) {
    await reviewFact(world.deps, job.factId, job.traceId)
  }
}

export interface SeedSense {
  pos: Pos
  gloss: string
  rank?: SenseRank
  register?: InventorySense['register']
  region?: InventorySense['region']
}

export interface Headword {
  entry: EntryNode
  /** The ids of the inventory's senses, in its order. */
  senses: SenseId[]
  inventory: FactOf<'senses'> | null
}

/**
 * Admits the lemma as a headword of batch 1 and, given senses, submits its inventory as `author`
 * and reviews it, so the inventory is published unless the reviewers say otherwise.
 */
export async function headword(
  world: FakeWorld,
  lemma: string,
  senses: readonly SeedSense[] = [],
  author: Actor = agentA,
): Promise<Headword> {
  const { entry } = await createEntry(world.deps, admin, { lemma, batch: 1 })
  if (senses.length === 0) return { entry, senses: [], inventory: null }
  const { fact } = await submitFact(world.deps, author, {
    kind: 'senses',
    subject_id: entry.id,
    payload: { senses: senses.map((sense) => ({ rank: 'common', ...sense })) },
  })
  await drainReviews(world)
  const inventory = world.facts.find((candidate) => candidate.id === fact.id) as FactOf<'senses'>
  return { entry, senses: inventory.payload.senses.map((sense) => sense.id), inventory }
}
