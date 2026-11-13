import type { EntryId, FactId, FactKind, FactPayloads, FactStatus, Pos, SenseId } from '@shared/facts'
import type { Gap, WorkItemId } from '@shared/work'
import { describe, expect, it } from 'vitest'
import type { EntrySnapshot } from './catalog-view'
import type { Fact, FactOf } from './fact'
import type { EntryNode, SenseNode } from './nodes'
import type { Lemma } from './term'
import { subjectOf, type WorkItem, workPriority } from './work'
import { REJECTIONS_SHOWN, workContext } from './work-context'

let counter = 0
const id = <T>() => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` as T
const at = '2026-01-01T00:00:00.000Z'

const entry = (lemma: string): EntryNode => ({
  id: id<EntryId>(),
  lemma: lemma as Lemma,
  createdBy: 'agent:a',
  createdAt: at,
})
const senseOf = (of: EntryNode, pos: Pos = 'noun'): SenseNode => ({
  id: id<SenseId>(),
  entryId: of.id,
  pos,
  createdBy: 'agent:a',
  createdAt: at,
})
function fact<K extends FactKind>(
  kind: K,
  subjectId: string,
  payload: FactPayloads[K],
  status: FactStatus = 'published',
  extra: Partial<Pick<Fact, 'supersedesId' | 'updatedAt'>> = {},
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
    createdAt: at,
    updatedAt: at,
    ...extra,
  } as FactOf<K>
}
type Listed = FactPayloads['senses']['senses'][number]
const inventory = (of: EntryNode, senses: Listed[], status: FactStatus = 'published') =>
  fact('senses', of.id, { senses }, status)
const listed = (node: SenseNode, gloss: string, extra: Partial<Listed> = {}): Listed => ({
  id: node.id,
  pos: node.pos,
  gloss,
  rank: 'common',
  ...extra,
})
const item = (of: EntryNode, gap: Gap): WorkItem => ({
  id: id<WorkItemId>(),
  entryId: of.id,
  type: gap.type,
  subjectId: subjectOf(gap, of.id),
  gap,
  ...workPriority(gap.type, { batch: 1, levelRank: null, zipf: null }),
  awaiting: false,
  attempts: 0,
  worked: false,
  foundNone: false,
  claimedGap: null,
  lease: null,
  lastWorkedAt: null,
  lastWorkedBy: null,
  lastNote: null,
})

const dog = entry('dog')
const [hound, pet] = [senseOf(dog), senseOf(dog)]
const animal = entry('animal')
const tail = entry('tail')
const nation = entry('nation')
const nameless = entry('nameless')
const [creature, part, country, people, lost] = [
  senseOf(animal),
  senseOf(tail),
  senseOf(nation),
  senseOf(nation),
  senseOf(nameless),
]
const dogInventory = inventory(dog, [
  listed(hound, 'A dog used for hunting.', { register: 'dated' }),
  listed(pet, 'An animal kept at home.', { rank: 'extra', region: 'british' }),
])
const hypernym = fact('relation', pet.id, { type: 'hypernym', target_sense_id: creature.id })
const synonyms = [country, people, lost].map((target) =>
  fact('relation', pet.id, { type: 'synonym', target_sense_id: target.id }, 'retracted'),
)
const stranger = fact('relation', pet.id, { type: 'synonym', target_sense_id: id<SenseId>() }, 'rejected', {
  updatedAt: '2026-01-02T00:00:00.000Z',
})
const grammar = fact('grammar', hound.id, { countability: 'countable' })
const incoming = [fact('relation', part.id, { type: 'part_of', target_sense_id: pet.id }, 'rejected')]
const nationPublished = inventory(nation, [listed(country, 'A country.')])
const snapshot: EntrySnapshot = {
  entry: { ...dog, live: true },
  batch: 1,
  levelRank: 1,
  zipf: 5.1,
  family: [],
  phraseType: null,
  sentences: new Map(),
  phraseEntries: new Map(),
  senses: [hound, pet],
  facts: [dogInventory, hypernym, ...synonyms, stranger, grammar],
  incoming,
  passes: new Set(),
  neighbors: {
    inventories: [
      inventory(animal, [listed(creature, 'A living creature.')]),
      inventory(tail, [listed(part, 'The end of an animal.')]),
      nationPublished,
      {
        ...inventory(nation, [listed(country, 'A country.'), listed(people, 'A people.')], 'pending'),
        supersedesId: nationPublished.id,
      },
      inventory(nameless, [listed(lost, 'Lost.')]),
    ],
    lemmas: new Map([
      [animal.id, 'animal'],
      [tail.id, 'tail'],
      [nation.id, 'nation'],
    ]),
    liveEntries: new Set([animal.id, nation.id, nameless.id]),
  },
}
const reference = { cefr: [{ pos: 'noun' as const, level: 'A1' as const }] }

describe('work context', () => {
  it('gives a sense item its entry, its sense, the facts about it, and the senses at the other end of its relations [spec: work/claim-context]', () => {
    const context = workContext(item(dog, { type: 'parts', sense_id: pet.id }), snapshot, reference, [])
    expect(context.entry).toEqual({
      id: dog.id,
      lemma: 'dog',
      cefr: [{ pos: 'noun', level: 'A1' }],
      zipf: 5.1,
      // The inventory's order; an extra sense is rare.
      senses: [
        {
          id: hound.id,
          pos: 'noun',
          gloss: 'A dog used for hunting.',
          register: 'dated',
          region: null,
          rare: false,
          status: 'published',
        },
        {
          id: pet.id,
          pos: 'noun',
          gloss: 'An animal kept at home.',
          register: null,
          region: 'british',
          rare: true,
          status: 'published',
        },
      ],
    })
    expect(context.sense?.id).toBe(pet.id)
    expect(context.facts).toEqual([hypernym, ...synonyms, stranger, ...incoming])
    expect(context.view).toBeNull()
    expect(context.criteria.fills.map((fill) => fill.kind)).toEqual(['relation'])
    // The rejected relations at this node, newest first.
    expect(context.rejections).toEqual([stranger, ...incoming])
  })

  it('gives no gloss for a related sense that cannot show, and leaves out an end no inventory lists [spec: work/claim-context-dead-ends]', () => {
    const context = workContext(item(dog, { type: 'synonyms', sense_id: pet.id }), snapshot, reference, [])
    expect(context.related).toEqual([
      { senseId: creature.id, lemma: 'animal', pos: 'noun', gloss: 'A living creature.' },
      { senseId: country.id, lemma: 'nation', pos: 'noun', gloss: 'A country.' },
      // Listed only by a pending correction: it cannot show yet.
      { senseId: people.id, lemma: 'nation', pos: 'noun', gloss: null },
      { senseId: lost.id, lemma: '', pos: 'noun', gloss: 'Lost.' },
      // Its entry is not live.
      { senseId: part.id, lemma: 'tail', pos: 'noun', gloss: null },
    ])
  })

  it('gives an entry item the whole view where the policy asks for it, and every rejection of its fill kinds [spec: work/claim-context]', () => {
    const rejected = Array.from({ length: REJECTIONS_SHOWN + 2 }, (_, at) =>
      fact('morphology', id<EntryId>(), { parts: [{ form: 'dog', role: 'base', lemma: 'dog' }] }, 'rejected', {
        updatedAt: `2026-01-01T00:00:${String(at).padStart(2, '0')}.000Z`,
      }),
    )
    const family = workContext(
      item(dog, { type: 'family' }),
      { ...snapshot, facts: [...snapshot.facts, ...rejected] },
      reference,
      [],
    )
    expect(family.sense).toBeNull()
    expect(family.view?.entry.id).toBe(dog.id)
    expect(family.facts).toEqual([dogInventory])
    expect(family.rejections).toEqual(rejected.slice(2).reverse())
    expect(workContext(item(dog, { type: 'syllables' }), snapshot, reference, []).view).toBeNull()
  })

  it('gives an entry without an inventory no senses, and a pending inventory its status', () => {
    const bare = workContext(item(dog, { type: 'senses' }), { ...snapshot, facts: [] }, reference, [])
    expect([bare.entry.senses, bare.sense, bare.view?.facts]).toEqual([[], null, incoming])
    const pending = workContext(
      item(dog, { type: 'senses' }),
      { ...snapshot, facts: [{ ...dogInventory, status: 'pending' }] },
      reference,
      [],
    )
    expect(pending.entry.senses.map((sense) => sense.status)).toEqual(['pending', 'pending'])
  })
})
