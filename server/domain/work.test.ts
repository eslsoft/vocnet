import type { EntryId, FactId, FactKind, FactPayloads, FactStatus, Pos, Review, SenseId, TopicId } from '@shared/facts'
import type { WorkLeaseId } from '@shared/work'
import { describe, expect, it } from 'vitest'
import type { Fact, FactOf } from './fact'
import type { SenseWithLemma } from './nodes'
import type { Lemma } from './term'
import {
  assessEntry,
  COLLOCATIONS_NEEDED,
  claimTier,
  completeDecision,
  entryGaps,
  GRAMMAR_NEEDED,
  isClaimable,
  isStalled,
  learnerBand,
  leaseExpiry,
  MAX_SENSE_LIST_ATTEMPTS,
  RELATIONS_NEEDED,
  TOPICS_NEEDED,
  type WorkLease,
} from './work'

let counter = 0
const id = <T>() => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` as T
const at = '2026-01-01T00:00:00.000Z'
const entryId = id<EntryId>()
const bank = { lemma: 'bank' }

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

const otherEntry = id<EntryId>()
/** Senses of another live entry, each with a live gloss, that the entry's relations link to. */
const neighbors = { senses: [] as SenseWithLemma[], facts: [fact('entry', otherEntry, {})] as Fact[] }
/** A sense of another entry whose gloss and entry fact are live, so a relation to it counts. */
function visibleSense(): SenseId {
  const other = { ...sense(), entryId: otherEntry }
  neighbors.senses.push(other)
  neighbors.facts.push(fact('sense', other.id, { gloss: 'a meaning' }))
  return other.id
}

describe('entryGaps', () => {
  it('lists every gap of a bare entry [spec: work/gaps]', () => {
    expect(
      entryGaps({ entry: bank, senses: [], facts: [fact('entry', entryId, {})], incoming: [], neighbors }),
    ).toEqual([{ type: 'senses' }, { type: 'forms' }, { type: 'pronunciation' }, { type: 'morphology' }])
  })

  it('asks for the word formation of a single word only [spec: work/usage-gaps]', () => {
    const facts = [fact('entry', entryId, {})]
    const phrase = entryGaps({ entry: { lemma: 'post office' }, senses: [], facts, incoming: [], neighbors })
    expect(phrase.map((gap) => gap.type)).toEqual(['senses', 'forms', 'pronunciation'])
    const morphology = fact('morphology', entryId, { parts: [{ form: 'bank', role: 'base' }] }, 'pending')
    const word = entryGaps({ entry: bank, senses: [], facts: [...facts, morphology], incoming: [], neighbors })
    expect(word.map((gap) => gap.type)).toEqual(['senses', 'forms', 'pronunciation'])
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
    expect(entryGaps({ entry: bank, senses: [glossed, rejected], facts, incoming: [], neighbors })).toEqual([
      { type: 'sense_list', rejected: 0 },
      { type: 'pronunciation' },
      { type: 'morphology' },
      { type: 'relations', sense_id: glossed.id, count: 0, have: [] },
      { type: 'examples', sense_id: glossed.id },
      { type: 'translations', sense_id: glossed.id, language: 'zh' },
      { type: 'topics', sense_id: glossed.id },
      { type: 'grammar', sense_id: glossed.id },
      { type: 'collocations', sense_id: glossed.id },
    ])
  })

  it('closes sense gaps with live examples, zh translations, grammar, collocations, and two relations in either direction', () => {
    const subject = sense()
    const object = sense()
    const elsewhere = visibleSense()
    const facts: Fact[] = [
      fact('sense', subject.id, { gloss: 'land beside a river' }),
      fact('sense', object.id, { gloss: 'the edge of a lake' }),
      fact('form', entryId, { form: 'banks', type: 'plural' }),
      fact('pronunciation', entryId, { ipa: 'bæŋk', accent: 'us' }),
      fact('relation', subject.id, { type: 'synonym', target_sense_id: elsewhere }),
      fact('relation', subject.id, { type: 'hypernym', target_sense_id: visibleSense() }, 'pending'),
      fact('relation', object.id, { type: 'part_of', target_sense_id: visibleSense() }),
      fact('example', subject.id, { text: 'We sat on the bank.' }),
      fact('example', object.id, { text: 'Retracted.' }, 'retracted'),
      fact('translation', subject.id, { language: 'zh', text: '河岸' }),
      fact('translation', object.id, { language: 'zh', text: '湖岸' }),
      fact('topic', subject.id, { topic_id: 'water-bodies' as TopicId }, 'pending'),
      fact('topic', object.id, { topic_id: 'landscape-landforms' as TopicId }),
      fact('morphology', entryId, { parts: [{ form: 'bank', role: 'base' }] }),
      fact('grammar', subject.id, { countability: 'countable' }),
      fact('grammar', object.id, { countability: 'countable' }, 'rejected'),
      fact('collocation', subject.id, { text: 'river bank', pattern: 'noun_noun' }, 'pending'),
      fact('collocation', object.id, { text: 'steep bank', pattern: 'adjective_noun' }),
      fact('sense_list', entryId, { common: [object.id, subject.id], extra: [] }, 'pending'),
    ]
    const incoming = [fact('relation', elsewhere, { type: 'hypernym', target_sense_id: object.id })]
    expect(entryGaps({ entry: bank, senses: [subject, object], facts, incoming, neighbors })).toEqual([
      { type: 'examples', sense_id: object.id },
      { type: 'grammar', sense_id: object.id },
    ])
  })

  it('closes a translations gap only with the served tag zh [spec: work/gaps]', () => {
    const subject = sense()
    const translationGaps = (language: string) =>
      entryGaps({
        entry: bank,
        senses: [subject],
        facts: [
          fact('sense', subject.id, { gloss: 'land beside a river' }),
          fact('translation', subject.id, { language, text: '河岸' }),
        ],
        incoming: [],
        neighbors,
      }).filter((gap) => gap.type === 'translations')
    expect(translationGaps('zh')).toEqual([])
    for (const language of ['zh-Hans', 'zh-Hant', 'fr']) {
      expect(translationGaps(language)).toEqual([{ type: 'translations', sense_id: subject.id, language: 'zh' }])
    }
  })

  it('keeps a relations gap open below two live relations and names the types and directions it has [spec: work/relations-gap]', () => {
    const focus = sense()
    const [kind, whole, part] = [visibleSense(), visibleSense(), visibleSense()]
    const base: Fact[] = [
      fact('sense', focus.id, { gloss: 'a branch of a tree' }),
      fact('example', focus.id, { text: 'A bird sat on the bough.' }),
      fact('translation', focus.id, { language: 'zh', text: '树枝' }),
    ]
    const relationGaps = (facts: Fact[], incoming: Fact[] = []) =>
      entryGaps({ entry: bank, senses: [focus], facts: [...base, ...facts], incoming, neighbors }).filter(
        (gap) => gap.type === 'relations',
      )

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

  it('counts a relation only while the sense at its other end has a live gloss and a live entry fact [spec: work/relations-visible-ends]', () => {
    const focus = sense()
    const [rejectedEntry, livingEntry] = [id<EntryId>(), id<EntryId>()]
    const end = (entry: EntryId, gloss: FactStatus) => {
      const other = { ...sense(), entryId: entry }
      return { other, gloss: fact('sense', other.id, { gloss: 'a meaning' }, gloss) }
    }
    const ofRejectedEntry = end(rejectedEntry, 'published')
    const unglossed = end(livingEntry, 'rejected')
    const pendingGloss = end(livingEntry, 'pending')
    const ends = {
      senses: [ofRejectedEntry.other, unglossed.other, pendingGloss.other],
      facts: [
        fact('entry', rejectedEntry, {}, 'rejected'),
        fact('entry', livingEntry, {}, 'pending'),
        ofRejectedEntry.gloss,
        unglossed.gloss,
        pendingGloss.gloss,
      ],
    }
    const facts: Fact[] = [
      fact('sense', focus.id, { gloss: 'a branch of a tree' }),
      fact('relation', focus.id, { type: 'synonym', target_sense_id: ofRejectedEntry.other.id }),
      fact('relation', focus.id, { type: 'antonym', target_sense_id: pendingGloss.other.id }),
    ]
    const incoming = [fact('relation', unglossed.other.id, { type: 'part_of', target_sense_id: focus.id })]
    const relations = entryGaps({ entry: bank, senses: [focus], facts, incoming, neighbors: ends }).filter(
      (gap) => gap.type === 'relations',
    )
    expect(relations).toEqual([
      { type: 'relations', sense_id: focus.id, count: 1, have: [{ type: 'antonym', direction: 'outgoing' }] },
    ])
    const unknown = entryGaps({ entry: bank, senses: [focus], facts, incoming, neighbors: { senses: [], facts: [] } })
    expect(unknown).toContainEqual({ type: 'relations', sense_id: focus.id, count: 0, have: [] })
  })
})

describe('sense list gap', () => {
  const [common, rare] = [sense(), sense()]
  const glosses = [
    fact('entry', entryId, {}),
    fact('sense', common.id, { gloss: 'land beside a river' }),
    fact('sense', rare.id, { gloss: 'a bank of oars' }),
  ]
  const inventory = (facts: Fact[], senses = [common, rare]) =>
    entryGaps({ entry: bank, senses, facts: [...glosses, ...facts], incoming: [], neighbors }).filter(
      (gap) => gap.type === 'senses' || gap.type === 'sense_list',
    )
  const list = (status: FactStatus = 'published', ids = { common: [common.id], extra: [rare.id] }) =>
    fact('sense_list', entryId, ids, status)

  it('asks for senses, then for a list naming exactly the live senses [spec: work/sense-list-gap]', () => {
    expect(entryGaps({ entry: bank, senses: [], facts: [glosses[0]], incoming: [], neighbors })[0]).toEqual({
      type: 'senses',
    })
    expect(inventory([])).toEqual([{ type: 'sense_list', rejected: 0 }])
    expect(inventory([list()])).toEqual([])
    expect(inventory([list('pending')])).toEqual([])
    expect(inventory([list('rejected')])).toEqual([{ type: 'sense_list', rejected: 1 }])
    // A live list with no live sense left settles nothing; the entry needs senses again.
    expect(inventory([list()], [])).toEqual([{ type: 'senses' }])
  })

  it('reopens when a sense is added or a listed sense is no longer live [spec: work/sense-list-gap]', () => {
    const added = sense()
    const addedGloss = fact('sense', added.id, { gloss: 'to rely on' }, 'pending')
    expect(inventory([list(), addedGloss], [common, rare, added])).toEqual([{ type: 'sense_list', rejected: 0 }])
    const withoutRare = [glosses[0], glosses[1], { ...glosses[2], status: 'rejected' } as Fact, list()]
    expect(
      entryGaps({ entry: bank, senses: [common, rare], facts: withoutRare, incoming: [], neighbors }).map(
        (gap) => gap.type,
      ),
    ).toContain('sense_list')
  })

  it('reads a pending correction in place of the list it supersedes [spec: work/sense-list-gap]', () => {
    const stale = list('published', { common: [common.id], extra: [] })
    const correction = { ...list('pending', { common: [rare.id, common.id], extra: [] }), supersedesId: stale.id }
    expect(inventory([stale])).toEqual([{ type: 'sense_list', rejected: 0 }])
    expect(inventory([stale, correction])).toEqual([])
    const settled = list('published')
    const staleCorrection = { ...list('pending', { common: [common.id], extra: [] }), supersedesId: settled.id }
    expect(inventory([settled, staleCorrection])).toEqual([{ type: 'sense_list', rejected: 0 }])
  })

  it('counts the rejected attempts at the current senses, up to a bound [spec: work/sense-list-attempts]', () => {
    const rejected = (count: number) => Array.from({ length: count }, () => list('rejected'))
    const counts = [0, 1, 2, 3, 5].map((count) => inventory(rejected(count)))
    expect(counts.map(([gap]) => (gap?.type === 'sense_list' ? gap.rejected : null))).toEqual([
      0,
      1,
      2,
      MAX_SENSE_LIST_ATTEMPTS - 1,
      MAX_SENSE_LIST_ATTEMPTS - 1,
    ])
    // A rejected list that named other senses was an attempt at a different inventory.
    const older = list('rejected', { common: [common.id], extra: [] })
    expect(inventory([older, ...rejected(1)])).toEqual([{ type: 'sense_list', rejected: 1 }])
    const assess = (facts: Fact[]) =>
      assessEntry({
        entry: bank,
        senses: [common, rare],
        facts: [...glosses, ...facts],
        incoming: [],
        flagged: new Set(),
        neighbors,
      }).openWork
    const claimed = { openWork: assess(rejected(MAX_SENSE_LIST_ATTEMPTS - 1)), completed: true }
    expect(isStalled(claimed, { openWork: assess(rejected(MAX_SENSE_LIST_ATTEMPTS - 2)) })).toBe(false)
    expect(isStalled(claimed, { openWork: assess(rejected(MAX_SENSE_LIST_ATTEMPTS)) })).toBe(true)
  })

  it('counts per-sense gaps and slots for the common senses only, once a list exists [spec: work/sense-list-scope]', () => {
    const perSense = (facts: Fact[]) =>
      entryGaps({
        entry: bank,
        senses: [common, rare],
        facts: [...glosses, ...facts],
        incoming: [],
        neighbors,
      }).flatMap((gap) => ('sense_id' in gap ? [gap.sense_id] : []))
    expect(new Set(perSense([]))).toEqual(new Set([common.id, rare.id]))
    expect(new Set(perSense([list()]))).toEqual(new Set([common.id]))
    expect(new Set(perSense([list('rejected')]))).toEqual(new Set([common.id, rare.id]))
    const score = (facts: Fact[]) =>
      assessEntry({
        entry: bank,
        senses: [common, rare],
        facts: [...glosses, ...facts],
        incoming: [],
        neighbors,
        flagged: new Set(),
      })
    // Before a list: four entry slots and seven per noun sense, none filled.
    expect(score([]).completeness).toBe(0)
    // With the list: the inventory slot filled, and only the common sense's seven slots count.
    expect(score([list()]).completeness).toBe(1 - 10 / 11)
    expect(score([list()]).openWork).not.toBe(score([]).openWork)
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
        const facts = [
          fact('sense', focus.id, { gloss: 'a meaning' }),
          fact('sense_list', entryId, { common: [focus.id], extra: [] }),
        ]
        const gap = entryGaps({ entry: bank, senses: [focus], facts, incoming: [], neighbors }).find(
          (open) => open.type === 'relations',
        )
        const { completeness } = assessEntry({
          entry: bank,
          senses: [focus],
          facts,
          incoming: [],
          flagged: new Set(),
          neighbors,
        })
        // Every slot but the sense inventory one is missing: forms, pronunciation, morphology, and the
        // sense's relations, example, translation, topics, grammar, and collocations as the pos needs them.
        return [pos, { gap: gap !== undefined, completeness }]
      }),
    )
    expect(needs).toEqual({
      noun: { gap: true, completeness: 1 - 10 / 11 },
      verb: { gap: true, completeness: 1 - 10 / 11 },
      adjective: { gap: true, completeness: 1 - 9 / 10 },
      adverb: { gap: true, completeness: 1 - 6 / 7 },
      pronoun: { gap: false, completeness: 1 - 5 / 6 },
      determiner: { gap: false, completeness: 1 - 5 / 6 },
      preposition: { gap: false, completeness: 1 - 5 / 6 },
      conjunction: { gap: false, completeness: 1 - 5 / 6 },
      interjection: { gap: false, completeness: 1 - 5 / 6 },
      auxiliary: { gap: false, completeness: 1 - 5 / 6 },
    })
    const adverb = sense('adverb')
    const linked = [
      fact('sense', adverb.id, { gloss: 'quickly' }),
      fact('relation', adverb.id, { type: 'synonym', target_sense_id: visibleSense() }),
    ]
    expect(
      entryGaps({ entry: bank, senses: [adverb], facts: linked, incoming: [], neighbors }).map((gap) => gap.type),
    ).not.toContain('relations')
  })
})

describe('grammar and collocations by part of speech', () => {
  it('needs grammar for nouns and verbs and collocations for nouns, verbs, and adjectives [spec: work/usage-gaps]', () => {
    const needs = Object.fromEntries(
      Object.keys(GRAMMAR_NEEDED).map((pos) => {
        const focus = sense(pos as Pos)
        const facts = [fact('sense', focus.id, { gloss: 'a meaning' })]
        const types = entryGaps({ entry: bank, senses: [focus], facts, incoming: [], neighbors }).map((gap) => gap.type)
        return [pos, { grammar: types.includes('grammar'), collocations: types.includes('collocations') }]
      }),
    )
    const content = ['noun', 'verb', 'adjective']
    expect(needs).toEqual(
      Object.fromEntries(
        Object.keys(GRAMMAR_NEEDED).map((pos) => [
          pos,
          { grammar: pos === 'noun' || pos === 'verb', collocations: content.includes(pos) },
        ]),
      ),
    )
    expect(Object.keys(COLLOCATIONS_NEEDED)).toEqual(Object.keys(GRAMMAR_NEEDED))
  })
})

describe('topics by part of speech', () => {
  it('opens a topics gap on noun, verb, and adjective senses until one live topic tags them [spec: work/topics-gap]', () => {
    const hospital = { topic_id: 'hospital-doctor' as TopicId }
    const gapsFor = (pos: Pos, topics: FactStatus[] = []) => {
      const focus = sense(pos)
      const facts: Fact[] = [
        fact('sense', focus.id, { gloss: 'a meaning' }),
        ...topics.map((status) => fact('topic', focus.id, hospital, status)),
      ]
      return { focus, gaps: entryGaps({ entry: bank, senses: [focus], facts, incoming: [], neighbors }) }
    }
    const open = Object.fromEntries(
      Object.keys(TOPICS_NEEDED).map((pos) => [pos, gapsFor(pos as Pos).gaps.some((gap) => gap.type === 'topics')]),
    )
    expect(open).toEqual({
      noun: true,
      verb: true,
      adjective: true,
      adverb: false,
      pronoun: false,
      determiner: false,
      preposition: false,
      conjunction: false,
      interjection: false,
      auxiliary: false,
    })
    const noun = gapsFor('noun')
    expect(noun.gaps).toContainEqual({ type: 'topics', sense_id: noun.focus.id })
    expect(gapsFor('noun', ['pending']).gaps.map((gap) => gap.type)).not.toContain('topics')
    const rejected = gapsFor('verb', ['rejected'])
    expect(rejected.gaps).toContainEqual({ type: 'topics', sense_id: rejected.focus.id })
  })
})

describe('assessEntry', () => {
  const focus = sense()
  const complete: Fact[] = [
    fact('entry', entryId, {}),
    fact('sense', focus.id, { gloss: 'land beside a river' }),
    fact('form', entryId, { form: 'banks', type: 'plural' }),
    fact('pronunciation', entryId, { ipa: 'bæŋk', accent: 'us' }),
    fact('relation', focus.id, { type: 'synonym', target_sense_id: visibleSense() }),
    fact('example', focus.id, { text: 'We sat on the bank.' }),
    fact('translation', focus.id, { language: 'zh', text: '河岸' }),
    fact('topic', focus.id, { topic_id: 'water-bodies' as TopicId }),
    fact('morphology', entryId, { parts: [{ form: 'bank', role: 'base' }] }),
    fact('grammar', focus.id, { countability: 'countable' }),
    fact('collocation', focus.id, { text: 'river bank', pattern: 'noun_noun' }),
    fact('sense_list', entryId, { common: [focus.id], extra: [] }),
  ]
  const incoming = [fact('relation', visibleSense(), { type: 'hypernym', target_sense_id: focus.id })]
  const assess = (facts: Fact[], more: { incoming?: Fact[]; flagged?: FactId[] } = {}) =>
    assessEntry({
      entry: bank,
      senses: [focus],
      facts,
      incoming: more.incoming ?? incoming,
      flagged: new Set(more.flagged),
      neighbors,
    })

  it('scores completeness as filled slots over the slots the gaps count [spec: work/scores]', () => {
    expect(assess(complete)).toMatchObject({ gaps: [], completeness: 1, quality: 1, weakFacts: [] })
    // One of two relations and the translation missing: 2 of 11 slots.
    const noTranslation = complete.filter((candidate) => candidate.kind !== 'translation')
    expect(assess(noTranslation, { incoming: [] }).completeness).toBe(1 - 2 / 11)
    // A bare entry counts only its four entry slots.
    expect(assess([complete[0]], { incoming: [] }).completeness).toBe(0)
    expect(assess([complete[0], complete[2]], { incoming: [] }).completeness).toBe(1 - 3 / 4)
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

  it('serves gaps before weak facts, then by learner band, never-claimed before claimed within a band [spec: work/claim-tiers]', () => {
    const gap = { completeness: 0.5, claimed: false }
    const bands = [
      { levelRank: 1, zipf: 3 },
      { levelRank: 2, zipf: null },
      { levelRank: 3, zipf: 6 },
      { levelRank: 4, zipf: 5 },
      { levelRank: 5, zipf: 2 },
      { levelRank: 6, zipf: 1 },
      { levelRank: null, zipf: 7 },
      { levelRank: null, zipf: null },
    ]
    expect(bands.map(learnerBand)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    const tiers = bands.flatMap((band) => [
      claimTier({ ...band, ...gap }),
      claimTier({ ...band, ...gap, claimed: true }),
    ])
    expect(tiers).toEqual([...Array(16).keys()])
    const qualityOnly = bands.map((band) => claimTier({ ...band, completeness: 1, claimed: false }))
    expect(qualityOnly).toEqual([16, 18, 20, 22, 24, 26, 28, 30])
    expect(Math.min(...qualityOnly)).toBeGreaterThan(Math.max(...tiers))
  })
})
