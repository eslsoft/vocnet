import type { EntryId, FactId, FactKind, FactPayloads, FactStatus, SenseId } from '@shared/facts'
import type { WorkLeaseId } from '@shared/work'
import { describe, expect, it } from 'vitest'
import type { Fact, FactOf } from './fact'
import type { SenseWithLemma } from './nodes'
import type { Lemma } from './term'
import { completeDecision, entryGaps, leaseExpiry, revisitAfterPass, type WorkLease } from './work'

let counter = 0
const id = <T>() => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` as T
const at = '2026-01-01T00:00:00.000Z'
const entryId = id<EntryId>()

const sense = (): SenseWithLemma => ({
  id: id<SenseId>(),
  entryId,
  pos: 'noun',
  lemma: 'bank' as Lemma,
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

describe('entryGaps', () => {
  it('lists every gap of a bare entry [spec: work/gaps]', () => {
    expect(entryGaps({ senses: [], facts: [fact('entry', entryId, {})], incoming: [] })).toEqual([
      { type: 'senses' },
      { type: 'forms' },
      { type: 'pronunciation' },
    ])
  })

  it('opens per-sense gaps for each sense whose gloss is live, counting pending facts', () => {
    const glossed = sense()
    const rejected = sense()
    const facts: Fact[] = [
      fact('entry', entryId, {}),
      fact('sense', glossed.id, { gloss: 'land beside a river' }),
      fact('sense', glossed.id, { gloss: 'sloping land beside a river' }, 'pending'),
      fact('sense', rejected.id, { gloss: 'a bench' }, 'rejected'),
      fact('form', entryId, { form: 'banks', type: 'plural' }, 'pending'),
      fact('translation', glossed.id, { language: 'fr', text: 'rive' }),
    ]
    expect(entryGaps({ senses: [glossed, rejected], facts, incoming: [] })).toEqual([
      { type: 'pronunciation' },
      { type: 'relations', sense_id: glossed.id, count: 0, have: [] },
      { type: 'examples', sense_id: glossed.id },
      { type: 'translations', sense_id: glossed.id, language: 'zh' },
    ])
  })

  it('closes sense gaps with live examples, zh translations, and two relations in either direction', () => {
    const subject = sense()
    const object = sense()
    const elsewhere = id<SenseId>()
    const facts: Fact[] = [
      fact('sense', subject.id, { gloss: 'land beside a river' }),
      fact('sense', object.id, { gloss: 'the edge of a lake' }),
      fact('form', entryId, { form: 'banks', type: 'plural' }),
      fact('pronunciation', entryId, { ipa: 'bæŋk', accent: 'us' }),
      fact('relation', subject.id, { type: 'synonym', target_sense_id: elsewhere }),
      fact('relation', subject.id, { type: 'hypernym', target_sense_id: id<SenseId>() }, 'pending'),
      fact('relation', object.id, { type: 'part_of', target_sense_id: id<SenseId>() }),
      fact('example', subject.id, { text: 'We sat on the bank.' }),
      fact('example', object.id, { text: 'Retracted.' }, 'retracted'),
      fact('translation', subject.id, { language: 'zh-Hans', text: '河岸' }),
      fact('translation', object.id, { language: 'zh', text: '湖岸' }),
    ]
    const incoming = [fact('relation', elsewhere, { type: 'hypernym', target_sense_id: object.id })]
    expect(entryGaps({ senses: [subject, object], facts, incoming })).toEqual([
      { type: 'examples', sense_id: object.id },
    ])
  })

  it('keeps a relations gap open below two live relations and names the types and directions it has [spec: work/relations-gap]', () => {
    const focus = sense()
    const [kind, whole, part] = [id<SenseId>(), id<SenseId>(), id<SenseId>()]
    const base: Fact[] = [
      fact('sense', focus.id, { gloss: 'a branch of a tree' }),
      fact('example', focus.id, { text: 'A bird sat on the bough.' }),
      fact('translation', focus.id, { language: 'zh', text: '树枝' }),
    ]
    const relationGaps = (facts: Fact[], incoming: Fact[] = []) =>
      entryGaps({ senses: [focus], facts: [...base, ...facts], incoming }).filter((gap) => gap.type === 'relations')

    expect(relationGaps([])).toEqual([{ type: 'relations', sense_id: focus.id, count: 0, have: [] }])
    const rejected = fact('relation', focus.id, { type: 'synonym', target_sense_id: kind }, 'rejected')
    const partOf = fact('relation', focus.id, { type: 'part_of', target_sense_id: whole })
    expect(relationGaps([rejected, partOf])).toEqual([
      { type: 'relations', sense_id: focus.id, count: 1, have: [{ type: 'part_of', direction: 'outgoing' }] },
    ])
    const twig = [fact('relation', part, { type: 'part_of', target_sense_id: focus.id }, 'pending')]
    expect(relationGaps([rejected], twig)).toEqual([
      { type: 'relations', sense_id: focus.id, count: 1, have: [{ type: 'part_of', direction: 'incoming' }] },
    ])
    expect(relationGaps([partOf], twig)).toEqual([])
  })
})

describe('work lease', () => {
  const lease: WorkLease = {
    id: id<WorkLeaseId>(),
    entryId,
    holder: 'agent:a',
    claimedAt: at,
    expiresAt: leaseExpiry(new Date(at), 900),
  }

  it('expires lease_seconds after the claim', () => {
    expect(lease.expiresAt).toBe('2026-01-01T00:15:00.000Z')
  })

  it('lets only the holder complete before expiry', () => {
    expect(completeDecision(lease, 'agent:a', new Date('2026-01-01T00:14:59.999Z'))).toBe('allowed')
    expect(completeDecision(lease, 'agent:b', new Date(at))).toBe('not_holder')
    expect(completeDecision(lease, 'agent:a', new Date(lease.expiresAt))).toBe('expired')
  })
})

describe('revisitAfterPass', () => {
  const claimedAt = '2026-01-01T01:00:00.000Z'
  const pass = { holder: 'agent:a', claimedAt } as const
  const during = <F extends Fact>(made: F, author = 'agent:a'): F => ({ ...made, author, createdAt: claimedAt }) as F

  it('revisits an entry only when the pass added a fact about it and gaps are still open [spec: work/revisit]', () => {
    const focus = sense()
    const finished: Fact[] = [
      fact('sense', focus.id, { gloss: 'land beside a river' }),
      fact('form', entryId, { form: 'banks', type: 'plural' }),
      fact('pronunciation', entryId, { ipa: 'bæŋk', accent: 'us' }),
      fact('example', focus.id, { text: 'We sat on the bank.' }),
      fact('translation', focus.id, { language: 'zh', text: '河岸' }),
      fact('relation', focus.id, { type: 'synonym', target_sense_id: id<SenseId>() }),
    ]
    const snapshot = (facts: Fact[], incoming: Fact[] = []) => ({ senses: [focus], facts, incoming })
    const neighbor = fact('relation', id<SenseId>(), { type: 'hypernym', target_sense_id: focus.id })

    expect(revisitAfterPass(snapshot(finished), pass)).toBe(false)
    expect(
      revisitAfterPass(snapshot([...finished, during(fact('example', focus.id, { text: 'A bank.' }))]), pass),
    ).toBe(true)
    expect(revisitAfterPass(snapshot(finished, [during(neighbor, 'agent:b')]), pass)).toBe(false)
    expect(revisitAfterPass(snapshot(finished, [during(neighbor)]), pass)).toBe(false)
    expect(revisitAfterPass(snapshot([...finished.slice(0, 5), during(finished[5])]), pass)).toBe(true)
  })
})
