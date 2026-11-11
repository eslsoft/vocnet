import type { EntryId, FactId, FactKind, FactPayloads, FactStatus, Pos, SenseId } from '@shared/facts'
import type { Gap, WorkItemId } from '@shared/work'
import { describe, expect, it } from 'vitest'
import type { EntrySnapshot } from './catalog-view'
import type { Fact, FactOf } from './fact'
import type { EntryNode, SenseWithLemma } from './nodes'
import type { Lemma } from './term'
import { type WorkItem, workPriority } from './work'
import { workContext } from './work-context'

let counter = 0
const id = <T>() => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` as T
const at = '2026-01-01T00:00:00.000Z'

const entry = (lemma: string): EntryNode => ({
  id: id<EntryId>(),
  lemma: lemma as Lemma,
  createdBy: 'agent:a',
  createdAt: at,
})
const sense = (of: EntryNode, pos: Pos = 'noun'): SenseWithLemma => ({
  id: id<SenseId>(),
  entryId: of.id,
  pos,
  lemma: of.lemma,
  createdBy: 'agent:a',
  createdAt: at,
})
function fact<K extends FactKind>(
  kind: K,
  subjectId: string,
  payload: FactPayloads[K],
  status: FactStatus = 'published',
): FactOf<K> {
  return {
    id: id<FactId>(),
    kind,
    subjectId: subjectId as never,
    objectId: kind === 'relation' ? (payload as FactPayloads['relation']).target_sense_id : null,
    contentKey: 'k',
    payload,
    status,
    supersedesId: null,
    author: 'agent:a',
    review: null,
    revalidateSince: null,
    createdAt: at,
    updatedAt: at,
  }
}
const item = (of: EntryNode, gap: Gap, subjectId: string): WorkItem => ({
  id: id<WorkItemId>(),
  entryId: of.id,
  type: gap.type,
  subjectId,
  gap,
  ...workPriority(gap.type, { levelRank: null, zipf: null }),
  awaiting: false,
  attempts: 0,
  worked: false,
  claimedGap: null,
  lease: null,
  lastWorkedAt: null,
  lastWorkedBy: null,
  lastNote: null,
})

const dog = entry('dog')
const [pet, hound] = [sense(dog), sense(dog)]
const animal = entry('animal')
const tail = entry('tail')
const [creature, part] = [sense(animal), sense(tail)]
const facts: Fact[] = [
  fact('entry', dog.id, {}),
  fact('sense', pet.id, { gloss: 'An animal kept at home.' }),
  fact('sense', hound.id, { gloss: 'A dog used for hunting.', register: 'dated' }, 'pending'),
  fact('sense_list', dog.id, { common: [hound.id], extra: [pet.id] }),
  fact('relation', pet.id, { type: 'hypernym', target_sense_id: creature.id }),
  fact('grammar', hound.id, { countability: 'countable' }),
]
const incoming = [fact('relation', part.id, { type: 'part_of', target_sense_id: pet.id }, 'rejected')]
const snapshot: EntrySnapshot = {
  entry: dog,
  seed: true,
  levelRank: 1,
  zipf: 5.1,
  coreVerb: false,
  phrases: [],
  family: [],
  senses: [pet, hound],
  facts,
  incoming,
  flagged: new Set(),
  neighbors: {
    senses: [creature, part],
    facts: [fact('entry', animal.id, {}), fact('sense', creature.id, { gloss: 'A living creature.' })],
  },
}
const reference = { cefr: [{ pos: 'noun' as const, level: 'A1' as const }] }

describe('work context', () => {
  it('gives a sense item its entry, its sense, the facts about it, and the senses at the other end of its relations [spec: work/claim-context]', () => {
    const context = workContext(item(dog, { type: 'parts', sense_id: pet.id }, pet.id), snapshot, reference)
    expect(context.entry).toEqual({
      id: dog.id,
      lemma: 'dog',
      cefr: [{ pos: 'noun', level: 'A1' }],
      zipf: 5.1,
      // Common senses first, in the list's order; the extra one is rare.
      senses: [
        {
          id: hound.id,
          pos: 'noun',
          gloss: 'A dog used for hunting.',
          register: 'dated',
          region: null,
          rare: false,
          status: 'pending',
        },
        {
          id: pet.id,
          pos: 'noun',
          gloss: 'An animal kept at home.',
          register: null,
          region: null,
          rare: true,
          status: 'published',
        },
      ],
    })
    expect(context.sense?.id).toBe(pet.id)
    expect(context.facts.map((candidate) => candidate.kind)).toEqual(['sense', 'relation', 'relation'])
    expect(context.related).toEqual([
      { senseId: creature.id, lemma: 'animal', pos: 'noun', gloss: 'A living creature.' },
      { senseId: part.id, lemma: 'tail', pos: 'noun', gloss: null },
    ])
    expect(context.view).toBeNull()
  })

  it('gives no gloss for a related sense that cannot show [spec: work/claim-context-dead-ends]', () => {
    const nation = entry('nation')
    const [country, people] = [sense(nation), sense(nation)]
    const deadEntry = entry('folk')
    const kin = sense(deadEntry)
    const dangling = {
      ...snapshot,
      facts: [
        ...facts,
        fact('relation', pet.id, { type: 'synonym', target_sense_id: country.id }, 'retracted'),
        fact('relation', pet.id, { type: 'synonym', target_sense_id: people.id }, 'retracted'),
        fact('relation', pet.id, { type: 'synonym', target_sense_id: kin.id }, 'retracted'),
      ],
      neighbors: {
        senses: [creature, part, country, people, kin],
        facts: [
          ...snapshot.neighbors.facts,
          fact('entry', nation.id, {}),
          fact('sense', country.id, { gloss: 'A country.' }),
          fact('sense', people.id, { gloss: 'A people.' }, 'retracted'),
          fact('entry', deadEntry.id, {}, 'rejected'),
          fact('sense', kin.id, { gloss: 'Relatives.' }),
        ],
      },
    }
    const context = workContext(item(dog, { type: 'synonyms', sense_id: pet.id }, pet.id), dangling, reference)
    expect(context.related.map(({ senseId, gloss }) => [senseId, gloss])).toEqual([
      [creature.id, 'A living creature.'],
      [country.id, 'A country.'],
      [people.id, null],
      [kin.id, null],
      [part.id, null],
    ])
  })

  it('gives an entry item the whole view where the policy asks for it, and a weak fact the node it is about', () => {
    const list = workContext(item(dog, { type: 'sense_list', senses: [pet.id, hound.id] }, dog.id), snapshot, reference)
    expect([list.sense, list.view?.seed, list.facts.map((candidate) => candidate.kind)]).toEqual([
      null,
      true,
      ['entry', 'sense_list'],
    ])
    const grammar = facts[5] as Fact
    const weak = workContext(
      item(dog, { type: 'weak_fact', fact_id: grammar.id, kind: 'grammar', reason: 'uncertain' }, grammar.id),
      snapshot,
      reference,
    )
    expect([weak.sense?.id, weak.facts.map((candidate) => candidate.kind), weak.view]).toEqual([
      hound.id,
      ['sense', 'grammar'],
      null,
    ])
    // Without a list the senses keep their order; a sense without a live gloss is left out.
    const unlisted = sense(dog)
    const bare = {
      ...snapshot,
      senses: [pet, hound, unlisted],
      facts: [
        ...facts.filter((candidate) => candidate.kind !== 'sense_list'),
        fact('sense', unlisted.id, { gloss: 'Gone.' }, 'rejected'),
      ],
    }
    const order = workContext(item(dog, { type: 'syllables' }, dog.id), bare, reference).entry.senses
    expect(order.map((candidate) => [candidate.id, candidate.rare])).toEqual([
      [pet.id, false],
      [hound.id, false],
    ])
    const gone = id<FactId>()
    expect(() =>
      workContext(
        item(dog, { type: 'weak_fact', fact_id: gone, kind: 'grammar', reason: 'uncertain' }, gone),
        snapshot,
        reference,
      ),
    ).toThrow(`Weak fact ${gone}`)
    const stranger = sense(entry('stranger'))
    const unknownEnd = {
      ...snapshot,
      facts: [...facts, fact('relation', pet.id, { type: 'synonym', target_sense_id: stranger.id })],
    }
    expect(() => workContext(item(dog, { type: 'synonyms', sense_id: pet.id }, pet.id), unknownEnd, reference)).toThrow(
      `Relation end ${stranger.id}`,
    )
  })
})
