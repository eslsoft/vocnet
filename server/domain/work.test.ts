import type { EntryId, FactId, FactKind, FactPayloads, FactStatus, Pos, Review, SenseId } from '@shared/facts'
import type { WorkLeaseId } from '@shared/work'
import { describe, expect, it } from 'vitest'
import type { Fact, FactOf } from './fact'
import type { SenseWithLemma } from './nodes'
import type { Lemma } from './term'
import {
  assessEntry,
  claimTier,
  completeDecision,
  entryGaps,
  isClaimable,
  isStalled,
  leaseExpiry,
  RELATIONS_NEEDED,
  type WorkLease,
} from './work'

let counter = 0
const id = <T>() => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` as T
const at = '2026-01-01T00:00:00.000Z'
const entryId = id<EntryId>()

const sense = (pos: Pos = 'noun'): SenseWithLemma => ({
  id: id<SenseId>(),
  entryId,
  pos,
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

const reviewed = <F extends Fact>(made: F, verdict: Review['verdict']): F =>
  ({
    ...made,
    review: {
      reviewer: 'jev',
      model: 'm',
      verdict,
      confidence: 0.5,
      reason: 'r',
      detail: {},
      context: {},
      reviewed_at: at,
    },
  }) as F

describe('relations by part of speech', () => {
  it('needs two relations for content words, one for adverbs, none for function words [spec: work/relations-by-pos]', () => {
    const needs = Object.fromEntries(
      Object.keys(RELATIONS_NEEDED).map((pos) => {
        const focus = sense(pos as Pos)
        const facts = [fact('sense', focus.id, { gloss: 'a meaning' })]
        const gap = entryGaps({ senses: [focus], facts, incoming: [] }).find((open) => open.type === 'relations')
        const { completeness } = assessEntry({ senses: [focus], facts, incoming: [], flagged: new Set() })
        // forms, pronunciation, the relations the pos needs, an example, and a translation are missing.
        return [pos, { gap: gap !== undefined, completeness }]
      }),
    )
    expect(needs).toEqual({
      noun: { gap: true, completeness: 1 - 6 / 7 },
      verb: { gap: true, completeness: 1 - 6 / 7 },
      adjective: { gap: true, completeness: 1 - 6 / 7 },
      adverb: { gap: true, completeness: 1 - 5 / 6 },
      pronoun: { gap: false, completeness: 1 - 4 / 5 },
      determiner: { gap: false, completeness: 1 - 4 / 5 },
      preposition: { gap: false, completeness: 1 - 4 / 5 },
      conjunction: { gap: false, completeness: 1 - 4 / 5 },
      interjection: { gap: false, completeness: 1 - 4 / 5 },
      auxiliary: { gap: false, completeness: 1 - 4 / 5 },
    })
    const adverb = sense('adverb')
    const linked = [
      fact('sense', adverb.id, { gloss: 'quickly' }),
      fact('relation', adverb.id, { type: 'synonym', target_sense_id: id<SenseId>() }),
    ]
    expect(entryGaps({ senses: [adverb], facts: linked, incoming: [] }).map((gap) => gap.type)).not.toContain(
      'relations',
    )
  })
})

describe('assessEntry', () => {
  const focus = sense()
  const complete: Fact[] = [
    fact('entry', entryId, {}),
    fact('sense', focus.id, { gloss: 'land beside a river' }),
    fact('form', entryId, { form: 'banks', type: 'plural' }),
    fact('pronunciation', entryId, { ipa: 'bæŋk', accent: 'us' }),
    fact('relation', focus.id, { type: 'synonym', target_sense_id: id<SenseId>() }),
    fact('example', focus.id, { text: 'We sat on the bank.' }),
    fact('translation', focus.id, { language: 'zh', text: '河岸' }),
  ]
  const incoming = [fact('relation', id<SenseId>(), { type: 'hypernym', target_sense_id: focus.id })]
  const assess = (facts: Fact[], more: { incoming?: Fact[]; flagged?: FactId[] } = {}) =>
    assessEntry({ senses: [focus], facts, incoming: more.incoming ?? incoming, flagged: new Set(more.flagged) })

  it('scores completeness as filled slots over the slots the gaps count [spec: work/scores]', () => {
    expect(assess(complete)).toMatchObject({ gaps: [], completeness: 1, quality: 1, weakFacts: [] })
    // One of two relations and the translation missing: 2 of 7 slots.
    expect(assess(complete.slice(0, 6), { incoming: [] }).completeness).toBe(1 - 2 / 7)
    // A bare entry counts only its three entry slots.
    expect(assess([complete[0]], { incoming: [] }).completeness).toBe(0)
    expect(assess([complete[0], complete[2]], { incoming: [] }).completeness).toBe(1 - 2 / 3)
  })

  it('scores quality from live facts that are uncertain or under open feedback [spec: work/scores]', () => {
    const uncertain = reviewed(complete[5], 'uncertain')
    const passed = reviewed(complete[6], 'pass')
    const pendingUncertain = reviewed({ ...complete[3], status: 'pending' }, 'uncertain')
    const retracted = { ...fact('example', focus.id, { text: 'Gone.' }), status: 'retracted' } as Fact
    const facts = [...complete.slice(0, 3), pendingUncertain, complete[4], uncertain, passed, retracted]
    const scored = assess(facts, { flagged: [complete[2].id, retracted.id] })
    expect(scored.weakFacts).toEqual([
      { id: complete[2].id, kind: 'form', reason: 'feedback' },
      { id: uncertain.id, kind: 'example', reason: 'uncertain' },
    ])
    expect(scored.quality).toBe(1 - 2 / 7)
    expect(assess([]).quality).toBe(1)
  })

  it('keys open work by gaps and weak slots, so a weak fact replaced by another weak one is no change', () => {
    const weak = reviewed(complete[5], 'uncertain')
    const correction = reviewed(fact('example', focus.id, { text: 'Another bank.' }), 'uncertain')
    const before = assess([...complete.slice(0, 5), weak, complete[6]])
    expect(assess([...complete.slice(0, 5), correction, complete[6]]).openWork).toBe(before.openWork)
    expect(assess(complete).openWork).not.toBe(before.openWork)
    expect(assess(complete.slice(0, 6)).openWork).not.toBe(assess(complete).openWork)
  })

  it('awaits review while a fact about the entry or a relation into its senses is pending [spec: work/admission]', () => {
    const pending = (candidate: Fact) => ({ ...candidate, status: 'pending' }) as Fact
    const rejected = { ...complete[5], status: 'rejected' } as Fact
    expect(assess([...complete, rejected]).awaitingReview).toBe(false)
    expect(assess([...complete.slice(0, 6), pending(complete[6])]).awaitingReview).toBe(true)
    expect(assess([pending(complete[0])], { incoming: [] }).awaitingReview).toBe(true)
    expect(assess(complete, { incoming: incoming.map(pending) }).awaitingReview).toBe(true)
  })
})

describe('worklist admission', () => {
  it('stalls an entry whose completed pass left the open work as the claim found it [spec: work/stall]', () => {
    const work = { openWork: 'gaps' }
    expect(isStalled({ openWork: 'gaps', completed: true }, work)).toBe(true)
    expect(isStalled({ openWork: 'gaps', completed: false }, work)).toBe(false)
    expect(isStalled({ openWork: 'other gaps', completed: true }, work)).toBe(false)
    expect(isStalled({ openWork: null, completed: true }, work)).toBe(false)
  })

  it('admits a live entry with work left that is neither stalled nor awaiting review, or whose scores are stale [spec: work/admission]', () => {
    const row = { live: true, stale: false, stalled: false, awaitingReview: false, completeness: 0.5, quality: 1 }
    expect(isClaimable(row)).toBe(true)
    expect(isClaimable({ ...row, awaitingReview: true })).toBe(false)
    expect(isClaimable({ ...row, awaitingReview: true, stale: true })).toBe(true)
    expect(isClaimable({ ...row, completeness: 1 })).toBe(false)
    expect(isClaimable({ ...row, completeness: 1, quality: 0.9 })).toBe(true)
    expect(isClaimable({ ...row, stalled: true })).toBe(false)
    expect(isClaimable({ ...row, stalled: true, stale: true })).toBe(true)
    expect(isClaimable({ ...row, completeness: 1, stale: true })).toBe(true)
    expect(isClaimable({ ...row, live: false, stale: true })).toBe(false)
  })

  it('serves seed entries first, never-claimed before claimed within each', () => {
    const tiers = [
      claimTier({ seed: true, claimed: false }),
      claimTier({ seed: true, claimed: true }),
      claimTier({ seed: false, claimed: false }),
      claimTier({ seed: false, claimed: true }),
    ]
    expect(tiers).toEqual([0, 1, 2, 3])
  })
})
