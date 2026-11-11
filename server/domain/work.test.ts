import type { EntryId, FactId, FactKind, FactPayloads, FactStatus, Pos, Review, SenseId, TopicId } from '@shared/facts'
import type { Gap, WorkItemId, WorkLeaseId } from '@shared/work'
import { describe, expect, it } from 'vitest'
import type { Fact, FactOf } from './fact'
import type { SenseWithLemma } from './nodes'
import type { Lemma } from './term'
import {
  assessEntry,
  COLLOCATIONS_NEEDED,
  completeDecision,
  entryGaps,
  GRAMMAR_NEEDED,
  gapText,
  itemState,
  learnerBand,
  leaseExpiry,
  MAX_ATTEMPTS,
  type OpenWork,
  reconcileItems,
  TOPICS_NEEDED,
  VERB_PARADIGM,
  WORK_POLICY,
  type WorkItem,
  type WorkLease,
  weakFacts,
  workPriority,
} from './work'

let counter = 0
const id = <T>() => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` as T
const at = '2026-01-01T00:00:00.000Z'
const entryId = id<EntryId>()
const bank = { id: entryId, lemma: 'bank' }
/** An entry with no CEFR level and no phrases, so the A1-A2 rules stay out of the way. */
const plain = { levelRank: null, coreVerb: false, phrases: [], family: [] }

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
      entryGaps({ entry: bank, ...plain, senses: [], facts: [fact('entry', entryId, {})], incoming: [], neighbors }),
    ).toEqual([
      { type: 'senses' },
      { type: 'pronunciation', accents: ['us', 'uk'] },
      { type: 'morphology' },
      { type: 'syllables' },
    ])
  })

  it('asks for the word formation of a single word only [spec: work/usage-gaps]', () => {
    const facts = [fact('entry', entryId, {})]
    const phrase = entryGaps({
      entry: { id: entryId, lemma: 'post office' },
      ...plain,
      senses: [],
      facts,
      incoming: [],
      neighbors,
    })
    expect(phrase.map((gap) => gap.type)).toEqual(['senses', 'pronunciation'])
    const morphology = fact('morphology', entryId, { parts: [{ form: 'bank', role: 'base' }] }, 'pending')
    const word = entryGaps({
      entry: bank,
      ...plain,
      senses: [],
      facts: [...facts, morphology],
      incoming: [],
      neighbors,
    })
    expect(word.map((gap) => gap.type)).toEqual(['senses', 'pronunciation', 'syllables'])
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
    expect(entryGaps({ entry: bank, ...plain, senses: [glossed, rejected], facts, incoming: [], neighbors })).toEqual([
      { type: 'sense_list', senses: [glossed.id] },
      { type: 'pronunciation', accents: ['us', 'uk'] },
      { type: 'morphology' },
      { type: 'syllables' },
      { type: 'category', sense_id: glossed.id },
      { type: 'synonyms', sense_id: glossed.id },
      { type: 'examples', sense_id: glossed.id, count: 0, need: 1 },
      { type: 'translations', sense_id: glossed.id, language: 'zh' },
      { type: 'example_translations', sense_id: glossed.id, language: 'zh', examples: [] },
      { type: 'topics', sense_id: glossed.id },
      { type: 'grammar', sense_id: glossed.id },
      { type: 'collocations', sense_id: glossed.id },
    ])
  })

  it('closes sense gaps with live examples, zh translations, grammar, collocations, a category, parts, and a synonym in either direction', () => {
    const subject = sense()
    const object = sense()
    const elsewhere = visibleSense()
    const facts: Fact[] = [
      fact('sense', subject.id, { gloss: 'land beside a river' }),
      fact('sense', object.id, { gloss: 'the edge of a lake' }),
      fact('form', entryId, { form: 'banks', type: 'plural' }),
      fact('pronunciation', entryId, { ipa: 'bæŋk', accent: 'us' }),
      fact('pronunciation', entryId, { ipa: 'bæŋk', accent: 'uk' }),
      fact('relation', subject.id, { type: 'synonym', target_sense_id: elsewhere }),
      fact('relation', subject.id, { type: 'hypernym', target_sense_id: visibleSense() }, 'pending'),
      fact('relation', object.id, { type: 'hypernym', target_sense_id: visibleSense() }),
      fact('relation', object.id, { type: 'part_of', target_sense_id: visibleSense() }),
      fact('gap_closure', object.id, { gap: 'parts', reason: 'An edge has no parts of its own.' }),
      fact('example', subject.id, { text: 'We sat on the bank.', translations: { zh: '我们坐在河岸上。' } }),
      fact('example', object.id, { text: 'Retracted.', translations: { zh: '撤回。' } }, 'retracted'),
      fact('translation', subject.id, { language: 'zh', text: '河岸' }),
      fact('translation', object.id, { language: 'zh', text: '湖岸' }),
      fact('topic', subject.id, { topic_id: 'water-bodies' as TopicId }, 'pending'),
      fact('topic', object.id, { topic_id: 'landscape-landforms' as TopicId }),
      fact('morphology', entryId, { parts: [{ form: 'bank', role: 'base' }] }),
      fact('syllables', entryId, { syllables: ['bank'] }, 'pending'),
      fact('grammar', subject.id, { countability: 'countable' }),
      fact('grammar', object.id, { countability: 'countable' }, 'rejected'),
      fact('collocation', subject.id, { text: 'river bank', pattern: 'noun_noun' }, 'pending'),
      fact('collocation', object.id, { text: 'steep bank', pattern: 'adjective_noun' }),
      fact('sense_list', entryId, { common: [object.id, subject.id], extra: [] }, 'pending'),
    ]
    const incoming = [
      fact('relation', elsewhere, { type: 'antonym', target_sense_id: object.id }),
      fact('relation', visibleSense(), { type: 'part_of', target_sense_id: subject.id }, 'pending'),
    ]
    expect(entryGaps({ entry: bank, ...plain, senses: [subject, object], facts, incoming, neighbors })).toEqual([
      { type: 'examples', sense_id: object.id, count: 0, need: 1 },
      { type: 'example_translations', sense_id: object.id, language: 'zh', examples: [] },
      { type: 'grammar', sense_id: object.id },
    ])
  })

  it('closes a translations gap only with the served tag zh [spec: work/gaps]', () => {
    const subject = sense()
    const translationGaps = (language: string) =>
      entryGaps({
        entry: bank,
        ...plain,
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

  it('asks a noun for an everyday category, then for its parts, and a content word for a synonym or antonym, with no quotas [spec: work/relation-slots]', () => {
    const focus = sense()
    const [kind, whole, part, taxon] = [visibleSense(), visibleSense(), visibleSense(), visibleSense()]
    const base: Fact[] = [
      fact('sense', focus.id, { gloss: 'a branch of a tree' }),
      fact('example', focus.id, { text: 'A bird sat on the bough.' }),
      fact('translation', focus.id, { language: 'zh', text: '树枝' }),
    ]
    const slots = (facts: Fact[], incoming: Fact[] = []) =>
      entryGaps({ entry: bank, ...plain, senses: [focus], facts: [...base, ...facts], incoming, neighbors }).filter(
        (gap) => gap.type === 'category' || gap.type === 'parts' || gap.type === 'synonyms',
      )
    const category = { type: 'category', sense_id: focus.id }
    const parts = { type: 'parts', sense_id: focus.id }
    const synonyms = { type: 'synonyms', sense_id: focus.id }
    expect(slots([])).toEqual([category, synonyms])
    // A domain hypernym is a specialist layer: it fills no everyday category, so no parts are asked yet.
    const biology = fact('relation', focus.id, { type: 'hypernym', target_sense_id: taxon, domain: 'biology' })
    expect(slots([biology])).toEqual([category, synonyms])
    // One everyday category fills the slot and opens the parts the thing has.
    const everyday = fact('relation', focus.id, { type: 'hypernym', target_sense_id: whole })
    expect(slots([biology, everyday])).toEqual([parts, synonyms])
    const twig = fact('relation', part, { type: 'part_of', target_sense_id: focus.id }, 'pending')
    expect(slots([everyday], [twig])).toEqual([synonyms])
    // Its own part_of fills nothing: the parts slot counts the parts attached to it.
    expect(slots([everyday, fact('relation', focus.id, { type: 'part_of', target_sense_id: kind })])).toEqual([
      parts,
      synonyms,
    ])
    const rejected = fact('relation', focus.id, { type: 'synonym', target_sense_id: kind }, 'rejected')
    expect(slots([everyday, rejected], [twig])).toEqual([synonyms])
    const antonym = fact('relation', kind, { type: 'antonym', target_sense_id: focus.id })
    expect(slots([everyday], [twig, antonym])).toEqual([])
    // A closed category is a general or abstract sense, which has no parts to ask for.
    const closed = fact('gap_closure', focus.id, { gap: 'category', reason: 'A general sense with no category.' })
    expect(slots([closed])).toEqual([synonyms])
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
    const slotTypes = (facts: Fact[], incoming: Fact[], around = ends) =>
      entryGaps({ entry: bank, ...plain, senses: [focus], facts, incoming, neighbors: around })
        .map((gap) => gap.type)
        .filter((type) => type === 'category' || type === 'parts' || type === 'synonyms')
    const gloss = fact('sense', focus.id, { gloss: 'a branch of a tree' })
    const hidden = [
      gloss,
      fact('relation', focus.id, { type: 'synonym', target_sense_id: ofRejectedEntry.other.id }),
      fact('relation', focus.id, { type: 'hypernym', target_sense_id: unglossed.other.id }),
    ]
    expect(slotTypes(hidden, [])).toEqual(['category', 'synonyms'])
    const shown = [
      gloss,
      fact('relation', focus.id, { type: 'antonym', target_sense_id: pendingGloss.other.id }),
      fact('relation', focus.id, { type: 'hypernym', target_sense_id: pendingGloss.other.id }),
    ]
    const parts = [fact('relation', unglossed.other.id, { type: 'part_of', target_sense_id: focus.id })]
    expect(slotTypes(shown, parts)).toEqual(['parts'])
    expect(slotTypes(shown, parts, { senses: [], facts: [] })).toEqual(['category', 'synonyms'])
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
    entryGaps({ entry: bank, ...plain, senses, facts: [...glosses, ...facts], incoming: [], neighbors }).filter(
      (gap) => gap.type === 'senses' || gap.type === 'sense_list',
    )
  const list = (status: FactStatus = 'published', ids = { common: [common.id], extra: [rare.id] }) =>
    fact('sense_list', entryId, ids, status)

  it('asks for senses, then for a list naming exactly the live senses [spec: work/sense-list-gap]', () => {
    expect(entryGaps({ entry: bank, ...plain, senses: [], facts: [glosses[0]], incoming: [], neighbors })[0]).toEqual({
      type: 'senses',
    })
    const both = { type: 'sense_list', senses: [common.id, rare.id] }
    expect(inventory([])).toEqual([both])
    expect(inventory([list()])).toEqual([])
    expect(inventory([list('pending')])).toEqual([])
    expect(inventory([list('rejected')])).toEqual([both])
    // A live list with no live sense left settles nothing; the entry needs senses again.
    expect(inventory([list()], [])).toEqual([{ type: 'senses' }])
  })

  it('reopens when a sense is added or a listed sense is no longer live [spec: work/sense-list-gap]', () => {
    const added = sense()
    const addedGloss = fact('sense', added.id, { gloss: 'to rely on' }, 'pending')
    expect(inventory([list(), addedGloss], [common, rare, added])).toEqual([
      { type: 'sense_list', senses: [common.id, rare.id, added.id] },
    ])
    const withoutRare = [glosses[0], glosses[1], { ...glosses[2], status: 'rejected' } as Fact, list()]
    expect(
      entryGaps({ entry: bank, ...plain, senses: [common, rare], facts: withoutRare, incoming: [], neighbors }).map(
        (gap) => gap.type,
      ),
    ).toContain('sense_list')
  })

  it('reads a pending correction in place of the list it supersedes [spec: work/sense-list-gap]', () => {
    const stale = list('published', { common: [common.id], extra: [] })
    const correction = { ...list('pending', { common: [rare.id, common.id], extra: [] }), supersedesId: stale.id }
    const both = { type: 'sense_list', senses: [common.id, rare.id] }
    expect(inventory([stale])).toEqual([both])
    expect(inventory([stale, correction])).toEqual([])
    const settled = list('published')
    const staleCorrection = { ...list('pending', { common: [common.id], extra: [] }), supersedesId: settled.id }
    expect(inventory([settled, staleCorrection])).toEqual([both])
  })

  it('leaves the gap as it was after a rejected list, so each rejected pass counts an attempt [spec: work/sense-list-attempts]', () => {
    const open = (facts: Fact[]) =>
      assessEntry({
        entry: bank,
        ...plain,
        senses: [common, rare],
        facts: [...glosses, ...facts],
        incoming: [],
        flagged: new Set(),
        neighbors,
      }).work.find((work) => work.gap.type === 'sense_list')
    const before = open([])
    const afterRejections = open([list('rejected'), list('rejected')])
    expect(afterRejections).toEqual(before)
    // While a list is pending its review, the item waits with the gap the list would close.
    expect(open([list('pending')])).toEqual({ ...before, awaiting: true })
  })

  it('counts per-sense gaps and slots for the common senses only, once a list exists [spec: work/sense-list-scope]', () => {
    const perSense = (facts: Fact[]) =>
      entryGaps({
        entry: bank,
        ...plain,
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
        ...plain,
        senses: [common, rare],
        facts: [...glosses, ...facts],
        incoming: [],
        neighbors,
        flagged: new Set(),
      })
    // Before a list: five entry slots and eight per noun sense, none filled.
    expect(score([]).completeness).toBe(0)
    // With the list: the inventory slot filled, and only the common sense's eight slots count.
    expect(score([list()]).completeness).toBe(1 - 12 / 13)
    expect(score([list()]).work).not.toEqual(score([]).work)
  })
})

describe('work lease', () => {
  const lease: WorkLease = {
    id: id<WorkLeaseId>(),
    holder: 'agent:a',
    type: 'category',
    entryIds: [entryId],
    itemIds: [],
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

describe('relation slots by part of speech', () => {
  it('asks only nouns for a category, content words for a synonym, and pronouns and other function words for none [spec: work/relation-slots-by-pos]', () => {
    const needs = Object.fromEntries(
      Object.keys(GRAMMAR_NEEDED).map((pos) => {
        const focus = sense(pos as Pos)
        const facts = [
          fact('sense', focus.id, { gloss: 'a meaning' }),
          fact('sense_list', entryId, { common: [focus.id], extra: [] }),
        ]
        const types = entryGaps({ entry: bank, ...plain, senses: [focus], facts, incoming: [], neighbors }).map(
          (open) => open.type,
        )
        const { completeness } = assessEntry({
          entry: bank,
          ...plain,
          senses: [focus],
          facts,
          incoming: [],
          flagged: new Set(),
          neighbors,
        })
        // Every slot but the sense inventory one is missing: forms, pronunciation, morphology,
        // syllables, and the sense's category, synonym, example, translation, translated example,
        // topics, grammar, and collocations as the pos needs them.
        return [pos, { category: types.includes('category'), synonyms: types.includes('synonyms'), completeness }]
      }),
    )
    expect(needs).toEqual({
      noun: { category: true, synonyms: true, completeness: 1 - 12 / 13 },
      // A verb's paradigm adds four form slots.
      verb: { category: false, synonyms: true, completeness: 1 - 15 / 16 },
      adjective: { category: false, synonyms: true, completeness: 1 - 10 / 11 },
      // An adverb adds a grammar and a collocation slot, a pronoun grammar, a determiner both, and a
      // preposition or conjunction a collocation.
      adverb: { category: false, synonyms: true, completeness: 1 - 10 / 11 },
      pronoun: { category: false, synonyms: false, completeness: 1 - 8 / 9 },
      determiner: { category: false, synonyms: false, completeness: 1 - 9 / 10 },
      number: { category: false, synonyms: false, completeness: 1 - 7 / 8 },
      preposition: { category: false, synonyms: false, completeness: 1 - 8 / 9 },
      conjunction: { category: false, synonyms: false, completeness: 1 - 8 / 9 },
      interjection: { category: false, synonyms: false, completeness: 1 - 7 / 8 },
      auxiliary: { category: false, synonyms: false, completeness: 1 - 7 / 8 },
    })
  })
})

describe('grammar and collocations by part of speech', () => {
  it('needs grammar for content words, adverbs, determiners, and pronouns, and collocations for content words, adverbs, determiners, prepositions, and conjunctions [spec: work/usage-gaps]', () => {
    const needs = Object.fromEntries(
      Object.keys(GRAMMAR_NEEDED).map((pos) => {
        const focus = sense(pos as Pos)
        const facts = [fact('sense', focus.id, { gloss: 'a meaning' })]
        const types = entryGaps({ entry: bank, ...plain, senses: [focus], facts, incoming: [], neighbors }).map(
          (gap) => gap.type,
        )
        return [pos, { grammar: types.includes('grammar'), collocations: types.includes('collocations') }]
      }),
    )
    const grammar = ['noun', 'verb', 'adjective', 'adverb', 'determiner', 'pronoun']
    const collocations = ['noun', 'verb', 'adjective', 'adverb', 'determiner', 'preposition', 'conjunction']
    expect(needs).toEqual(
      Object.fromEntries(
        Object.keys(GRAMMAR_NEEDED).map((pos) => [
          pos,
          { grammar: grammar.includes(pos), collocations: collocations.includes(pos) },
        ]),
      ),
    )
    expect(Object.keys(COLLOCATIONS_NEEDED)).toEqual(Object.keys(GRAMMAR_NEEDED))
  })
})

describe('topics by part of speech', () => {
  it('opens a topics gap on noun and verb senses until one live topic tags them [spec: work/topics-gap]', () => {
    const hospital = { topic_id: 'hospital-doctor' as TopicId }
    const gapsFor = (pos: Pos, topics: FactStatus[] = []) => {
      const focus = sense(pos)
      const facts: Fact[] = [
        fact('sense', focus.id, { gloss: 'a meaning' }),
        ...topics.map((status) => fact('topic', focus.id, hospital, status)),
      ]
      return { focus, gaps: entryGaps({ entry: bank, ...plain, senses: [focus], facts, incoming: [], neighbors }) }
    }
    const open = Object.fromEntries(
      Object.keys(TOPICS_NEEDED).map((pos) => [pos, gapsFor(pos as Pos).gaps.some((gap) => gap.type === 'topics')]),
    )
    expect(open).toEqual({
      noun: true,
      verb: true,
      adjective: false,
      adverb: false,
      pronoun: false,
      determiner: false,
      number: false,
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

describe('new usage gaps', () => {
  it('asks for syllables of a single word, a translated example per sense, and a pronunciation per irregular form [spec: work/field-gaps]', () => {
    const go = { id: entryId, lemma: 'go' }
    const focus = sense('verb')
    const facts: Fact[] = [
      fact('entry', entryId, {}),
      fact('sense', focus.id, { gloss: 'to move' }),
      fact('form', entryId, { form: 'went', type: 'past' }),
      fact('form', entryId, { form: 'gone', type: 'past_participle' }),
      fact('form', entryId, { form: 'goes', type: 'third_person_singular' }),
      fact('form', entryId, { form: 'went', type: 'past', ipa: 'went', accent: 'us' }, 'pending'),
      fact('example', focus.id, { text: 'We go home.' }),
    ]
    const untranslated = facts.at(-1)?.id
    const corrected = fact('example', focus.id, { text: 'They go out.' })
    const translated = [
      fact('example', focus.id, { text: 'I go now.', translations: { zh: '我现在走。' } }),
      corrected,
      {
        ...fact('example', focus.id, { text: 'They go out.', translations: { zh: '他们出去。' } }, 'pending'),
        supersedesId: corrected.id,
      },
    ]
    const gaps = entryGaps({ entry: go, ...plain, senses: [focus], facts, incoming: [], neighbors })
    expect(gaps).toContainEqual({ type: 'syllables' })
    expect(gaps).toContainEqual({ type: 'form_pronunciations', forms: ['gone'] })
    expect(gaps).toContainEqual({
      type: 'example_translations',
      sense_id: focus.id,
      language: 'zh',
      examples: [untranslated],
    })
    // Each untranslated live example is named; a pending correction that adds a translation stands
    // for its original, and the slots follow the live examples.
    const more = { entry: go, ...plain, senses: [focus], facts: [...facts, ...translated], incoming: [], neighbors }
    expect(entryGaps(more).find((gap) => gap.type === 'example_translations')).toEqual({
      type: 'example_translations',
      sense_id: focus.id,
      language: 'zh',
      examples: [untranslated],
    })
    const translatedAll = { ...more, facts: [...facts.slice(0, -1), ...translated] }
    expect(entryGaps(translatedAll).map((gap) => gap.type)).not.toContain('example_translations')
    const phrase = entryGaps({
      entry: { id: entryId, lemma: 'go out' },
      ...plain,
      senses: [],
      facts: facts.slice(0, 1),
      incoming: [],
      neighbors,
    })
    expect(phrase.map((gap) => gap.type)).not.toContain('syllables')
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
    fact('example', focus.id, { text: 'We sat on the bank.', translations: { zh: '我们坐在河岸上。' } }),
    fact('translation', focus.id, { language: 'zh', text: '河岸' }),
    fact('topic', focus.id, { topic_id: 'water-bodies' as TopicId }),
    fact('morphology', entryId, { parts: [{ form: 'bank', role: 'base' }] }),
    fact('grammar', focus.id, { countability: 'countable' }),
    fact('collocation', focus.id, { text: 'river bank', pattern: 'noun_noun' }),
    fact('sense_list', entryId, { common: [focus.id], extra: [] }),
    fact('syllables', entryId, { syllables: ['bank'] }),
    fact('pronunciation', entryId, { ipa: 'bæŋk', accent: 'uk' }),
    fact('relation', focus.id, { type: 'hypernym', target_sense_id: visibleSense() }),
  ]
  const incoming = [fact('relation', visibleSense(), { type: 'part_of', target_sense_id: focus.id })]
  const assess = (facts: Fact[], more: { incoming?: Fact[]; flagged?: FactId[] } = {}) =>
    assessEntry({
      entry: bank,
      ...plain,
      senses: [focus],
      facts,
      incoming: more.incoming ?? incoming,
      flagged: new Set(more.flagged),
      neighbors,
    })

  it('scores completeness as filled slots over the slots the gaps count [spec: work/scores]', () => {
    expect(assess(complete)).toEqual({ work: [], completeness: 1, quality: 1 })
    // The parts and the translation missing: 2 of 15 slots.
    const noTranslation = complete.filter((candidate) => candidate.kind !== 'translation')
    expect(assess(noTranslation, { incoming: [] }).completeness).toBe(1 - 2 / 15)
    // A bare entry counts only its five entry slots: the inventory, two accents, formation, syllables.
    expect(assess([complete[0]], { incoming: [] }).completeness).toBe(0)
    expect(assess([complete[0], complete[3]], { incoming: [] }).completeness).toBe(1 - 4 / 5)
  })

  it('scores quality from live facts that are uncertain or under open feedback, each a weak fact [spec: work/scores]', () => {
    const uncertain = reviewed(complete[5], 'uncertain')
    const passed = reviewed(complete[6], 'pass')
    const pendingUncertain = reviewed({ ...complete[3], status: 'pending' }, 'uncertain')
    const retracted = { ...fact('example', focus.id, { text: 'Gone.' }), status: 'retracted' } as Fact
    const facts = [...complete.slice(0, 3), pendingUncertain, complete[4], uncertain, passed, retracted]
    const scored = assess(facts, { flagged: [complete[2].id, retracted.id] })
    const weak = [
      { type: 'weak_fact', fact_id: complete[2].id, kind: 'form', reason: 'feedback' },
      { type: 'weak_fact', fact_id: uncertain.id, kind: 'example', reason: 'uncertain' },
    ]
    expect(scored.work.filter((work) => work.gap.type === 'weak_fact')).toEqual(
      weak.map((gap) => ({ gap, subjectId: gap.fact_id, awaiting: false })),
    )
    expect(scored.quality).toBe(1 - 2 / 7)
    expect(assess([]).quality).toBe(1)
  })

  it('stops listing a weak fact a live correction replaces, which awaits that review [spec: work/weak-facts]', () => {
    const weak = reviewed(complete[5], 'uncertain')
    const correction = { ...fact('example', focus.id, { text: 'Another bank.' }, 'pending'), supersedesId: weak.id }
    const facts = [...complete.slice(0, 5), weak, ...complete.slice(6)]
    expect(weakFacts({ facts, flagged: new Set() })).toEqual([
      { type: 'weak_fact', fact_id: weak.id, kind: 'example', reason: 'uncertain' },
    ])
    expect(weakFacts({ facts: [...facts, correction], flagged: new Set() })).toEqual([])
    const item = assess([...facts, correction]).work.find((work) => work.gap.type === 'weak_fact')
    expect(item).toEqual({
      gap: { type: 'weak_fact', fact_id: weak.id, kind: 'example', reason: 'uncertain' },
      subjectId: weak.id,
      awaiting: true,
    })
  })

  it('awaits review exactly where a pending fact changes the open work, and lists none for a dead entry [spec: work/awaiting-review]', () => {
    const pending = (candidate: Fact) => ({ ...candidate, status: 'pending' }) as Fact
    const rejected = { ...complete[5], status: 'rejected' } as Fact
    expect(assess([...complete, rejected]).work).toEqual([])
    // A pending translation closes its gap only once it publishes: the item waits for the verdict.
    expect(assess([...complete.slice(0, 6), pending(complete[6]), ...complete.slice(7)]).work).toEqual([
      { gap: { type: 'translations', sense_id: focus.id, language: 'zh' }, subjectId: focus.id, awaiting: true },
    ])
    // An unrelated gap of the same entry stays workable while another awaits review.
    const noTopic = complete.filter((candidate) => candidate.kind !== 'topic')
    expect(assess([...noTopic.slice(0, 6), pending(complete[6]), ...noTopic.slice(7)]).work).toContainEqual({
      gap: { type: 'topics', sense_id: focus.id },
      subjectId: focus.id,
      awaiting: false,
    })
    // A pending relation into a sense counts for the gap it fills.
    expect(assess(complete, { incoming: incoming.map(pending) }).work).toEqual([
      { gap: { type: 'parts', sense_id: focus.id }, subjectId: focus.id, awaiting: true },
    ])
    // A pending entry fact holds every item for its review; a rejected one leaves no work at all.
    expect(assess([pending(complete[0])], { incoming: [] }).work.every((work) => work.awaiting)).toBe(true)
    expect(assess([{ ...complete[0], status: 'rejected' } as Fact], { incoming: [] }).work).toEqual([])
  })
})

describe('work items', () => {
  const sensed = sense()
  const learner = { levelRank: 1, zipf: 5.2 }
  const open = (gap: Gap, awaiting = false): OpenWork => ({
    gap,
    subjectId: 'sense_id' in gap ? gap.sense_id : entryId,
    awaiting,
  })
  const category: Gap = { type: 'category', sense_id: sensed.id }
  const examples = (count: number): Gap => ({ type: 'examples', sense_id: sensed.id, count, need: 2 })
  const stored = (gap: Gap, more: Partial<WorkItem> = {}): WorkItem => ({
    id: id<WorkItemId>(),
    entryId,
    type: gap.type,
    subjectId: 'sense_id' in gap ? gap.sense_id : entryId,
    gap,
    ...workPriority(gap.type, learner),
    awaiting: false,
    attempts: 0,
    worked: false,
    claimedGap: null,
    lease: null,
    lastWorkedAt: null,
    lastWorkedBy: null,
    lastNote: null,
    ...more,
  })

  it('ranks A1 and A2 through every stage first, then the rest by stage, band, and frequency [spec: work/item-priority]', () => {
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
    // A1 and A2 finish every stage before any other band's work; within a tier, the stage comes first.
    const a2Examples = workPriority('examples', bands[1]).rank
    const b1Senses = workPriority('senses', bands[2]).rank
    const a1Category = workPriority('category', bands[0]).rank
    const a1Translations = workPriority('translations', bands[0]).rank
    const a1Examples = workPriority('examples', bands[0]).rank
    expect(a2Examples).toBeLessThan(b1Senses)
    expect(workPriority('weak_fact', bands[1]).rank).toBeLessThan(b1Senses)
    expect(a1Category).toBeLessThan(a1Translations)
    expect(a1Translations).toBeLessThan(a1Examples)
    expect(workPriority('topics', bands[5]).rank).toBeLessThan(workPriority('translations', bands[2]).rank)
    expect(workPriority('weak_fact', bands[0]).rank).toBeGreaterThan(workPriority('examples', bands[1]).rank)
    expect(workPriority('examples', { levelRank: null, zipf: null }).zipfOrder).toBe(-1)
    expect(workPriority('examples', bands[2]).zipfOrder).toBe(6)
    expect(Object.fromEntries(Object.entries(WORK_POLICY).map(([type, { stage }]) => [type, stage]))).toEqual({
      senses: 1,
      sense_list: 1,
      category: 2,
      parts: 2,
      synonyms: 2,
      family: 2,
      phrases: 2,
      topics: 2,
      translations: 3,
      examples: 4,
      example_translations: 4,
      grammar: 4,
      collocations: 4,
      forms: 4,
      pronunciation: 4,
      syllables: 4,
      morphology: 4,
      form_pronunciations: 4,
      weak_fact: 5,
    })
  })

  it('upserts the open work by type and node and deletes the rest [spec: work/item-upsert]', () => {
    const kept = stored(category, { attempts: 1 })
    const closed = stored(examples(0))
    const { writes, deletes } = reconcileItems([kept, closed], [open(category), open({ type: 'syllables' })], learner)
    expect(deletes).toEqual([closed.id])
    expect(writes).toEqual([
      {
        id: kept.id,
        type: 'category',
        subjectId: sensed.id,
        gap: category,
        awaiting: false,
        attempts: 1,
        worked: false,
        ...workPriority('category', learner),
      },
      {
        id: null,
        type: 'syllables',
        subjectId: entryId,
        gap: { type: 'syllables' },
        awaiting: false,
        attempts: 0,
        worked: false,
        ...workPriority('syllables', learner),
      },
    ])
  })

  it('counts an attempt for a worked item its pass left as claimed, once its reviews settle [spec: work/item-attempts]', () => {
    const claimed = stored(category, { worked: true, claimedGap: category, attempts: 1 })
    const attemptsAfter = (item: WorkItem, work: OpenWork) => reconcileItems([item], [work], learner).writes[0]
    // Unchanged after the pass: an attempt, and the verdict is drawn.
    expect(attemptsAfter(claimed, open(category))).toMatchObject({ attempts: 2, worked: false })
    // Its facts pending: the item waits with its attempts and its pending verdict.
    expect(attemptsAfter(claimed, open(category, true))).toMatchObject({ attempts: 1, worked: true, awaiting: true })
    // A partial fill is progress: the attempts start over.
    const filling = stored(examples(0), { worked: true, claimedGap: examples(0), attempts: 2 })
    expect(attemptsAfter(filling, open(examples(1)))).toMatchObject({ attempts: 0, worked: false })
    // Another principal's change of an item nobody worked also starts it over; no change keeps it.
    const idle = stored(examples(0), { attempts: 2 })
    expect(attemptsAfter(idle, open(examples(1)))).toMatchObject({ attempts: 0 })
    expect(attemptsAfter(idle, open(examples(0)))).toMatchObject({ attempts: 2 })
    // Gaps compare by what they say, not by the order of their keys.
    expect(gapText({ sense_id: sensed.id, type: 'category' } as Gap)).toBe(gapText(category))
  })

  it('moves an item to the curators once three passes leave it unchanged [spec: work/item-curation]', () => {
    expect(itemState({ awaiting: false, attempts: MAX_ATTEMPTS - 1 })).toBe('open')
    expect(itemState({ awaiting: true, attempts: 0 })).toBe('awaiting_review')
    expect(itemState({ awaiting: false, attempts: MAX_ATTEMPTS })).toBe('curation')
  })
})

describe('completeness rules for a learner dictionary', () => {
  const gapsOf = (
    lemma: string,
    senses: SenseWithLemma[],
    facts: Fact[],
    more: { levelRank?: number | null; coreVerb?: boolean; phrases?: string[]; family?: string[] } = {},
  ) =>
    entryGaps({
      entry: { id: entryId, lemma },
      levelRank: more.levelRank ?? null,
      coreVerb: more.coreVerb ?? false,
      phrases: more.phrases ?? [],
      family: more.family ?? [],
      senses,
      facts: [fact('entry', entryId, {}), ...facts],
      incoming: [],
      neighbors,
    })
  const formsGap = (gaps: ReturnType<typeof entryGaps>) => gaps.find((gap) => gap.type === 'forms')

  it('asks for the inflections each part of speech takes, filled by label or by where the form shows [spec: work/form-paradigm]', () => {
    const verb = sense('verb')
    const noun = sense('noun')
    const glosses = [fact('sense', verb.id, { gloss: 'to walk' }), fact('sense', noun.id, { gloss: 'a walk' })]
    expect(formsGap(gapsOf('walk', [verb, noun], glosses))).toEqual({
      type: 'forms',
      missing: VERB_PARADIGM.map((type) => ({ type, pos: 'verb' })),
    })
    // A countable noun sense adds the plural; an unlabelled form fills the slot its type shows under.
    const countable = fact('grammar', noun.id, { countability: 'both' })
    const forms = [
      fact('form', entryId, { form: 'walks', type: 'third_person_singular' }),
      fact('form', entryId, { form: 'walked', type: 'past', pos: 'verb' }),
      fact('form', entryId, { form: 'walked', type: 'past_participle' }, 'pending'),
      fact('form', entryId, { form: 'walking', type: 'present_participle' }, 'rejected'),
    ]
    expect(formsGap(gapsOf('walk', [verb, noun], [...glosses, countable, ...forms]))).toEqual({
      type: 'forms',
      missing: [
        { type: 'present_participle', pos: 'verb' },
        { type: 'plural', pos: 'noun' },
      ],
    })
    // A form labelled with another part of speech fills nothing here.
    const plural = fact('form', entryId, { form: 'walks', type: 'plural', pos: 'pronoun' })
    expect(formsGap(gapsOf('walk', [noun], [glosses[1], countable, plural]))?.missing).toEqual([
      { type: 'plural', pos: 'noun' },
    ])
    // An uncountable noun and an invariable word need no form.
    const advice = fact('grammar', noun.id, { countability: 'uncountable' })
    expect(formsGap(gapsOf('advice', [noun], [glosses[1], advice]))).toBeUndefined()
    const ago = sense('adverb')
    expect(formsGap(gapsOf('ago', [ago], [fact('sense', ago.id, { gloss: 'Before now.' })]))).toBeUndefined()
    expect(formsGap(gapsOf('walk out', [verb], [glosses[0]]))).toBeUndefined()
  })

  it('asks for comparisons only of a word that compares with -er and -est [spec: work/form-paradigm]', () => {
    const adjective = sense('adjective')
    const gloss = fact('sense', adjective.id, { gloss: 'Large in size.' })
    const syllables = (...parts: string[]) => fact('syllables', entryId, { syllables: parts })
    const comparison = [
      { type: 'comparative', pos: 'adjective' },
      { type: 'superlative', pos: 'adjective' },
    ]
    expect(formsGap(gapsOf('big', [adjective], [gloss, syllables('big')]))?.missing).toEqual(comparison)
    expect(formsGap(gapsOf('happy', [adjective], [gloss, syllables('hap', 'py')]))?.missing).toEqual(comparison)
    expect(formsGap(gapsOf('careful', [adjective], [gloss, syllables('care', 'ful')]))).toBeUndefined()
    expect(formsGap(gapsOf('big', [adjective], [gloss]))).toBeUndefined()
    // A periphrastic comparison is no inflection: it neither fills a slot nor shows the word compares.
    const periphrastic = fact('form', entryId, { form: 'more careful', type: 'comparative' })
    expect(formsGap(gapsOf('careful', [adjective], [gloss, syllables('care', 'ful'), periphrastic]))).toBeUndefined()
    // A recorded inflected comparison asks for the rest of it, for an adverb too.
    const adverb = sense('adverb')
    const soon = [fact('sense', adverb.id, { gloss: 'In a short time.' })]
    expect(formsGap(gapsOf('soon', [adverb], soon))).toBeUndefined()
    const sooner = fact('form', entryId, { form: 'sooner', type: 'comparative' })
    expect(formsGap(gapsOf('soon', [adverb], [...soon, sooner]))?.missing).toEqual([
      { type: 'superlative', pos: 'adverb' },
    ])
  })

  it('needs a strong pronunciation in both accents [spec: work/pronunciation-accents]', () => {
    const pronounce = (accent: 'us' | 'uk', strength?: 'weak') =>
      fact('pronunciation', entryId, { ipa: 'tuː', accent, ...(strength ? { strength } : {}) })
    const accents = (facts: Fact[]) => gapsOf('to', [], facts).find((gap) => gap.type === 'pronunciation')
    expect(accents([pronounce('us')])).toEqual({ type: 'pronunciation', accents: ['uk'] })
    expect(accents([pronounce('us'), pronounce('uk', 'weak')])).toEqual({ type: 'pronunciation', accents: ['uk'] })
    expect(accents([pronounce('us'), pronounce('uk')])).toBeUndefined()
  })

  it('asks function words and adverbs for the usage a learner needs, each closable [spec: work/function-word-usage]', () => {
    const typesOf = (pos: Pos, more: Fact[] = []) => {
      const focus = sense(pos)
      const gaps = gapsOf('each', [focus], [fact('sense', focus.id, { gloss: 'Every one of two or more.' }), ...more])
      return { focus, types: gaps.map((gap) => gap.type) }
    }
    // Every adverb, not only a manner adverb, needs grammar and a collocation.
    expect(typesOf('adverb').types).toEqual(expect.arrayContaining(['grammar', 'collocations', 'synonyms']))
    expect(typesOf('determiner').types).toEqual(expect.arrayContaining(['grammar', 'collocations']))
    expect(typesOf('pronoun').types).toContain('grammar')
    expect(typesOf('pronoun').types).not.toContain('synonyms')
    expect(typesOf('pronoun').types).not.toContain('collocations')
    expect(typesOf('preposition').types).toContain('collocations')
    expect(typesOf('preposition').types).not.toContain('grammar')
    expect(typesOf('conjunction').types).toContain('collocations')
    expect(typesOf('interjection').types).not.toContain('collocations')
    const determiner = sense('determiner')
    const closed = gapsOf(
      'each',
      [determiner],
      [
        fact('sense', determiner.id, { gloss: 'Every one of two or more.' }),
        fact('grammar', determiner.id, { agreement: ['singular_noun', 'of_plural'] }),
        fact('gap_closure', determiner.id, { gap: 'collocations', reason: 'It combines freely.' }),
      ],
    ).map((gap) => gap.type)
    expect(closed).not.toContain('grammar')
    expect(closed).not.toContain('collocations')
  })

  it('asks a number sense for examples and translations only [spec: work/number-senses]', () => {
    for (const [lemma, gloss] of [
      ['two', 'The number 2.'],
      ['first', 'Coming before all others in order.'],
    ]) {
      const focus = sense('number')
      const gaps = gapsOf(lemma, [focus], [fact('sense', focus.id, { gloss })], { levelRank: 1 })
      expect(gaps.filter((gap) => 'sense_id' in gap && gap.sense_id === focus.id).map((gap) => gap.type)).toEqual([
        'examples',
        'translations',
        'example_translations',
      ])
      expect(gaps.find((gap) => gap.type === 'examples')).toMatchObject({ need: 2 })
      expect(gaps.map((gap) => gap.type)).not.toContain('forms')
    }
  })

  it('needs two examples of each counted sense of an A1 or A2 entry [spec: work/core-examples]', () => {
    const noun = sense('noun')
    const facts = [
      fact('sense', noun.id, { gloss: 'A place for money.' }),
      fact('example', noun.id, { text: 'The bank is open.' }),
    ]
    const examples = (levelRank: number | null) =>
      gapsOf('bank', [noun], facts, { levelRank }).find((gap) => gap.type === 'examples')
    expect(examples(1)).toEqual({ type: 'examples', sense_id: noun.id, count: 1, need: 2 })
    expect(examples(2)).toEqual({ type: 'examples', sense_id: noun.id, count: 1, need: 2 })
    expect(examples(3)).toBeUndefined()
    expect(examples(null)).toBeUndefined()
  })

  it('asks a core verb, listed at A1 or A2 as a verb, for three phrases headed by it [spec: work/phrases-gap]', () => {
    const verb = sense('verb')
    const noun = sense('noun')
    const asVerb = [fact('sense', verb.id, { gloss: 'To hand over.' })]
    const phrasesGap = (lemma: string, coreVerb: boolean, found: string[], senses = [verb], facts = asVerb) =>
      gapsOf(lemma, senses, facts, { levelRank: 1, coreVerb, phrases: found }).find((gap) => gap.type === 'phrases')
    expect(phrasesGap('give', true, [])).toEqual({ type: 'phrases', have: [], need: 3 })
    expect(phrasesGap('give', true, ['give up'])).toEqual({ type: 'phrases', have: ['give up'], need: 3 })
    expect(phrasesGap('give', true, ['give in', 'give up'])).toEqual({
      type: 'phrases',
      have: ['give in', 'give up'],
      need: 3,
    })
    expect(phrasesGap('give', true, ['give in', 'give up', 'give way'])).toBeUndefined()
    // An A1 noun with a verb sense (telephone, party) is no core verb: it heads few learner phrasal verbs.
    expect(phrasesGap('telephone', false, [])).toBeUndefined()
    expect(phrasesGap('give up', true, [])).toBeUndefined()
    expect(phrasesGap('desk', true, [], [noun], [fact('sense', noun.id, { gloss: 'A table.' })])).toBeUndefined()
    // Each missing phrase is a slot, and a closure fills them all.
    const score = (found: string[], more: Fact[] = []) =>
      assessEntry({
        entry: { id: entryId, lemma: 'give' },
        levelRank: 1,
        coreVerb: true,
        phrases: found,
        family: ['giver'],
        senses: [verb],
        facts: [fact('entry', entryId, {}), ...asVerb, ...more],
        incoming: [],
        flagged: new Set(),
        neighbors,
      }).completeness
    expect(score(['give up'])).toBeGreaterThan(score([]))
    const closure = fact('gap_closure', entryId, { gap: 'phrases', reason: 'Only give up and give in are common.' })
    expect(score(['give in', 'give up'], [closure])).toBeGreaterThan(score(['give in', 'give up']))
  })

  it('asks an A1 or A2 single word for a word family member, filled by a linked derivative [spec: work/family-gap]', () => {
    const adjective = sense('adjective')
    const facts = [fact('sense', adjective.id, { gloss: 'Feeling pleasure.' })]
    const familyGap = (lemma: string, levelRank: number | null, family: string[], more: Fact[] = []) =>
      gapsOf(lemma, [adjective], [...facts, ...more], { levelRank, family }).find((gap) => gap.type === 'family')
    expect(familyGap('happy', 1, [])).toEqual({ type: 'family' })
    expect(familyGap('happy', 2, [])).toEqual({ type: 'family' })
    expect(familyGap('happy', 1, ['happiness'])).toBeUndefined()
    expect(familyGap('happy', 3, [])).toBeUndefined()
    expect(familyGap('happy', null, [])).toBeUndefined()
    expect(familyGap('good night', 1, [])).toBeUndefined()
    const closure = fact('gap_closure', entryId, { gap: 'family', reason: 'A compound with no derivatives.' })
    expect(familyGap('notebook', 1, [], [closure])).toBeUndefined()
  })

  it('closes exactly the gap a live closure names on its node, counting its slots as filled [spec: work/gap-closure]', () => {
    const month = sense('noun')
    const other = sense('noun')
    const base: Fact[] = [
      fact('sense', month.id, { gloss: 'The fifth month.' }),
      fact('sense', other.id, { gloss: 'A girl’s name.' }),
      fact('sense_list', entryId, { common: [month.id, other.id], extra: [] }),
    ]
    const closure = (subjectId: string, gap: 'collocations' | 'forms' | 'topics', status: FactStatus = 'published') =>
      fact('gap_closure', subjectId, { gap, reason: 'A month name has no common collocations.' }, status)
    const collocationGaps = (facts: Fact[]) =>
      gapsOf('May', [month, other], [...base, ...facts]).flatMap((gap) =>
        gap.type === 'collocations' ? [gap.sense_id] : [],
      )
    expect(collocationGaps([])).toEqual([month.id, other.id])
    expect(collocationGaps([closure(month.id, 'collocations', 'pending')])).toEqual([other.id])
    expect(collocationGaps([closure(month.id, 'collocations', 'rejected')])).toEqual([month.id, other.id])
    expect(collocationGaps([closure(month.id, 'topics')])).toEqual([month.id, other.id])
    // An entry gap closes on the entry.
    const verb = sense('verb')
    const verbGloss = fact('sense', verb.id, { gloss: 'To beware.' })
    expect(formsGap(gapsOf('beware', [verb], [verbGloss, closure(entryId, 'forms')]))).toBeUndefined()
    expect(formsGap(gapsOf('beware', [verb], [verbGloss, closure(verb.id, 'forms')]))).toBeDefined()
    // A closed gap's slots count as filled.
    const score = (facts: Fact[]) =>
      assessEntry({
        entry: { id: entryId, lemma: 'beware' },
        ...plain,
        senses: [verb],
        facts: [fact('entry', entryId, {}), verbGloss, ...facts],
        incoming: [],
        flagged: new Set(),
        neighbors,
      }).completeness
    expect(score([closure(entryId, 'forms')]) - score([])).toBeCloseTo(4 / 16)
  })
})
