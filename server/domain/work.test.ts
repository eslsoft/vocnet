import type { EntryId, FactId, FactKind, FactPayloads, FactStatus, Pos, Review, SenseId, TopicId } from '@shared/facts'
import { type Gap, MAX_PASSES, type WorkItemId, type WorkType } from '@shared/work'
import { describe, expect, it } from 'vitest'
import type { Fact, FactOf } from './fact'
import {
  assessEntry,
  COLLOCATIONS_NEEDED,
  completeDecision,
  type EntryFacts,
  entryGaps,
  filledSince,
  GRAMMAR_NEEDED,
  gapText,
  itemState,
  learnerBand,
  leaseExpiry,
  missingOf,
  type OpenWork,
  passKey,
  reconcileItems,
  subjectOf,
  TOPICS_NEEDED,
  VERB_PARADIGM,
  WORK_POLICY,
  type WorkItem,
  type WorkLease,
  workPriority,
} from './work'

let counter = 0
const id = <T>() => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` as T
const at = '2026-01-01T00:00:00.000Z'
const entryId = id<EntryId>()

function fact<K extends FactKind>(
  kind: K,
  subjectId: string,
  payload: FactPayloads[K],
  status: FactStatus = 'published',
  extra: Partial<Pick<Fact, 'supersedesId' | 'review'>> = {},
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

type Listed = { id: SenseId; pos: Pos; rank?: 'common' | 'extra' }
const sense = (pos: Pos = 'noun', rank: 'common' | 'extra' = 'common'): Listed => ({ id: id<SenseId>(), pos, rank })

/** The `senses` fact of an entry listing these senses in order. */
const inventory = (subject: string, senses: readonly Listed[], status: FactStatus = 'published') =>
  fact(
    'senses',
    subject,
    { senses: senses.map((one) => ({ id: one.id, pos: one.pos, gloss: 'a meaning', rank: one.rank ?? 'common' })) },
    status,
  )

const otherEntry = id<EntryId>()
const deadEntry = id<EntryId>()
/** A sense of another live entry whose published inventory lists it, so a relation to it counts. */
const shown = sense()
const hidden = sense()
const neighbors: EntryFacts['neighbors'] = {
  inventories: [inventory(otherEntry, [shown]), inventory(deadEntry, [hidden])],
  liveEntries: new Set([otherEntry]),
}

/** An entry with no CEFR level, no family, and no passes, so those rules stay out of the way. */
function snapshot(facts: Fact[], over: Partial<EntryFacts> & { lemma?: string } = {}): EntryFacts {
  const { lemma = 'bank', ...rest } = over
  return {
    entry: { id: entryId, lemma, live: true },
    levelRank: null,
    family: [],
    facts,
    incoming: [],
    passes: new Set(),
    neighbors,
    ...rest,
  }
}
const gapsOf = (facts: Fact[], over: Partial<EntryFacts> & { lemma?: string } = {}) => entryGaps(snapshot(facts, over))
const typesOf = (gaps: Gap[]) => gaps.map((gap) => gap.type)
const ofSense = (gaps: Gap[], senseId: SenseId) =>
  gaps.filter((gap) => 'sense_id' in gap && gap.sense_id === senseId).map((gap) => gap.type)

describe('entryGaps', () => {
  it('asks an entry without an inventory for its inventory alone [spec: work/gaps]', () => {
    expect(gapsOf([])).toEqual([{ type: 'senses' }])
    // A rejected inventory is no inventory.
    const noun = sense()
    expect(gapsOf([inventory(entryId, [noun], 'rejected')])).toEqual([{ type: 'senses' }])
  })

  it('lists every gap of an inventoried single word, counting pending facts [spec: work/gaps]', () => {
    const noun = sense()
    expect(gapsOf([inventory(entryId, [noun], 'pending')])).toEqual([
      { type: 'pronunciation', accents: ['us', 'uk'] },
      { type: 'phrases' },
      { type: 'morphology' },
      { type: 'syllables' },
      { type: 'translations', language: 'zh', missing: [{ of: 'sense', id: noun.id }] },
      { type: 'category', sense_id: noun.id },
      { type: 'synonyms', sense_id: noun.id },
      { type: 'examples', sense_id: noun.id, count: 0, need: 1 },
      { type: 'topics', sense_id: noun.id },
      { type: 'grammar', sense_id: noun.id },
      { type: 'collocations', sense_id: noun.id },
    ])
  })

  it('asks a phrase for no phrases, word formation, or syllables [spec: work/usage-gaps]', () => {
    const noun = sense()
    const phrase = gapsOf([inventory(entryId, [noun])], { lemma: 'post office' })
    expect(typesOf(phrase).slice(0, 2)).toEqual(['pronunciation', 'translations'])
    expect(typesOf(phrase)).not.toContain('phrases')
    expect(typesOf(phrase)).not.toContain('morphology')
    expect(typesOf(phrase)).not.toContain('syllables')
    const filled = gapsOf([
      inventory(entryId, [noun]),
      fact('morphology', entryId, { parts: [{ form: 'bank', role: 'base' }] }, 'pending'),
      fact('syllables', entryId, { syllables: ['bank'] }),
      fact('phrases', entryId, { phrases: ['bank on'] }),
    ])
    expect(typesOf(filled)).not.toContain('morphology')
    expect(typesOf(filled)).not.toContain('syllables')
    expect(typesOf(filled)).not.toContain('phrases')
  })

  it('reads a pending correction of the inventory in place of the one it supersedes [spec: work/gaps]', () => {
    const [kept, dropped, added] = [sense(), sense(), sense('verb')]
    const original = inventory(entryId, [kept, dropped])
    const correction = { ...inventory(entryId, [kept, added], 'pending'), supersedesId: original.id }
    const gaps = gapsOf([original, correction])
    expect(ofSense(gaps, dropped.id)).toEqual([])
    expect(ofSense(gaps, kept.id)).toContain('examples')
    expect(ofSense(gaps, added.id)).toContain('examples')
  })

  it('counts the common senses of the inventory only, its extras never [spec: work/sense-list-scope]', () => {
    const [common, rare] = [sense(), sense('noun', 'extra')]
    const gaps = gapsOf([inventory(entryId, [common, rare])])
    expect(ofSense(gaps, common.id).length).toBeGreaterThan(0)
    expect(ofSense(gaps, rare.id)).toEqual([])
    expect(gaps.find((gap) => gap.type === 'translations')).toEqual({
      type: 'translations',
      language: 'zh',
      missing: [{ of: 'sense', id: common.id }],
    })
  })

  it('gives the first three common senses and the first of each other part of speech every per-sense slot [spec: work/core-senses]', () => {
    const nouns = [sense(), sense(), sense(), sense()]
    const verb = sense('verb')
    const fourth = nouns[3] as Listed
    const gaps = gapsOf([inventory(entryId, [...nouns, verb])])
    expect(ofSense(gaps, nouns[0]?.id as SenseId)).toEqual([
      'category',
      'synonyms',
      'examples',
      'topics',
      'grammar',
      'collocations',
    ])
    // A sense beyond the core needs only an example and its grammar.
    expect(ofSense(gaps, fourth.id)).toEqual(['examples', 'grammar'])
    expect(ofSense(gaps, verb.id)).toEqual(['synonyms', 'examples', 'topics', 'grammar', 'collocations'])
  })

  it('closes per-sense gaps with live examples, topics, grammar, and collocations [spec: work/gaps]', () => {
    const noun = sense()
    const gaps = gapsOf([
      inventory(entryId, [noun]),
      fact('example', noun.id, { text: 'I went to the bank.' }, 'pending'),
      fact('topic', noun.id, { topic_id: 'finance' as TopicId }),
      fact('grammar', noun.id, { countability: 'countable' }),
      fact('collocation', noun.id, { text: 'bank account', pattern: 'noun_noun' }),
      fact('grammar', noun.id, { countability: 'countable' }, 'rejected'),
    ])
    expect(ofSense(gaps, noun.id)).toEqual(['category', 'synonyms'])
  })
})

describe('translations gap', () => {
  it('needs every common sense, its current examples, and its collocations translated into each served language [spec: work/translations-gap]', () => {
    const noun = sense()
    const old = fact('example', noun.id, { text: 'The bank is open.' })
    const correction = fact('example', noun.id, { text: 'The bank opens at nine.' }, 'pending', {
      supersedesId: old.id,
    })
    const collocation = fact('collocation', noun.id, { text: 'bank account', pattern: 'noun_noun' })
    const base = [inventory(entryId, [noun]), old, correction, collocation]
    const translations = (facts: Fact[]) => gapsOf(facts).find((gap) => gap.type === 'translations')
    expect(translations(base)).toEqual({
      type: 'translations',
      language: 'zh',
      missing: [
        { of: 'sense', id: noun.id },
        { of: 'example', id: correction.id },
        { of: 'collocation', id: collocation.id },
      ],
    })
    // A translation fills its target only when it says what it translates; a rejected one fills nothing.
    const partial = [
      ...base,
      fact('translation', noun.id, { language: 'zh', of: 'sense', text: '银行' }, 'pending'),
      fact('translation', correction.id, { language: 'zh', of: 'collocation', text: '银行九点开门。' }),
      fact('translation', collocation.id, { language: 'zh', of: 'collocation', text: '银行账户' }, 'rejected'),
    ]
    expect(translations(partial)).toEqual({
      type: 'translations',
      language: 'zh',
      missing: [
        { of: 'example', id: correction.id },
        { of: 'collocation', id: collocation.id },
      ],
    })
    const full = [
      ...partial,
      fact('translation', correction.id, { language: 'zh', of: 'example', text: '银行九点开门。' }),
      fact('translation', collocation.id, { language: 'zh', of: 'collocation', text: '银行账户' }),
    ]
    expect(translations(full)).toBeUndefined()
  })
})

describe('relation slots', () => {
  it('asks a noun for an everyday category, then for its parts, and a content word for a synonym [spec: work/relation-slots]', () => {
    const noun = sense()
    const base = [inventory(entryId, [noun])]
    expect(ofSense(gapsOf(base), noun.id)).not.toContain('parts')
    // A domain hypernym is no everyday category.
    const domain = fact('relation', noun.id, { type: 'hypernym', target_sense_id: shown.id, domain: 'biology' })
    expect(ofSense(gapsOf([...base, domain]), noun.id)).toContain('category')
    const category = fact('relation', noun.id, { type: 'hypernym', target_sense_id: shown.id })
    const categorized = gapsOf([...base, category])
    expect(ofSense(categorized, noun.id).slice(0, 2)).toEqual(['parts', 'synonyms'])
    const part = fact('relation', shown.id, { type: 'part_of', target_sense_id: noun.id })
    const antonym = fact('relation', shown.id, { type: 'antonym', target_sense_id: noun.id })
    const linked = gapsOf([...base, category], { incoming: [part, antonym] })
    expect(ofSense(linked, noun.id)).toEqual(['examples', 'topics', 'grammar', 'collocations'])
    const synonym = fact('relation', noun.id, { type: 'synonym', target_sense_id: shown.id }, 'pending')
    expect(ofSense(gapsOf([...base, synonym]), noun.id)).not.toContain('synonyms')
  })

  it('counts a relation only while its other end is listed by a live entry inventory [spec: work/relations-visible-ends]', () => {
    const noun = sense()
    const base = [inventory(entryId, [noun])]
    const unknown = sense()
    for (const target of [hidden.id, unknown.id]) {
      const gaps = gapsOf([
        ...base,
        fact('relation', noun.id, { type: 'hypernym', target_sense_id: target }),
        fact('relation', noun.id, { type: 'synonym', target_sense_id: target }),
      ])
      expect(ofSense(gaps, noun.id).slice(0, 2)).toEqual(['category', 'synonyms'])
    }
    // An incoming relation from a sense that cannot show fills nothing either.
    const incoming = [fact('relation', hidden.id, { type: 'synonym', target_sense_id: noun.id })]
    expect(ofSense(gapsOf(base, { incoming }), noun.id)).toContain('synonyms')
    // A neighbor's pending inventory correction stands for the published one it would replace.
    const replaced = sense()
    const moved = sense()
    const original = inventory(otherEntry, [replaced])
    const correction = { ...inventory(otherEntry, [moved], 'pending'), supersedesId: original.id }
    const through = (target: SenseId) =>
      gapsOf([...base, fact('relation', noun.id, { type: 'synonym', target_sense_id: target })], {
        neighbors: { inventories: [original, correction], liveEntries: new Set([otherEntry]) },
      })
    expect(ofSense(through(moved.id), noun.id)).not.toContain('synonyms')
    expect(ofSense(through(replaced.id), noun.id)).toContain('synonyms')
  })

  it('asks only nouns for a category and parts, content words for a synonym [spec: work/relation-slots-by-pos]', () => {
    const poses: Pos[] = ['verb', 'adjective', 'adverb', 'pronoun']
    const senses = poses.map((pos) => sense(pos))
    const gaps = gapsOf([inventory(entryId, senses)])
    const relationTypes = (one: Listed) =>
      ofSense(gaps, one.id).filter((type) => ['category', 'parts', 'synonyms'].includes(type))
    expect(senses.map(relationTypes)).toEqual([['synonyms'], ['synonyms'], ['synonyms'], []])
  })
})

describe('per-sense slots by part of speech', () => {
  it('opens a topics gap on noun and verb senses until one live topic tags them [spec: work/topics-gap]', () => {
    expect(Object.entries(TOPICS_NEEDED).filter(([, need]) => need > 0)).toEqual([
      ['noun', 1],
      ['verb', 1],
    ])
    const [verb, adjective] = [sense('verb'), sense('adjective')]
    const gaps = gapsOf([inventory(entryId, [verb, adjective])])
    expect(ofSense(gaps, verb.id)).toContain('topics')
    expect(ofSense(gaps, adjective.id)).not.toContain('topics')
    const tagged = gapsOf([
      inventory(entryId, [verb, adjective]),
      fact('topic', verb.id, { topic_id: 'travel' as TopicId }, 'pending'),
    ])
    expect(ofSense(tagged, verb.id)).not.toContain('topics')
  })

  it('asks function words and adverbs for the usage a learner needs [spec: work/function-word-usage]', () => {
    expect(GRAMMAR_NEEDED.determiner).toBe(1)
    expect(COLLOCATIONS_NEEDED.pronoun).toBe(0)
    const poses: Pos[] = ['adverb', 'determiner', 'pronoun', 'preposition', 'conjunction']
    const senses = poses.map((pos) => sense(pos))
    // Each its own entry, so every sense is the first of its part of speech and core.
    const usage = (one: Listed) =>
      ofSense(gapsOf([inventory(entryId, [one])]), one.id).filter((type) => ['grammar', 'collocations'].includes(type))
    expect(senses.map(usage)).toEqual([
      ['grammar', 'collocations'],
      ['grammar', 'collocations'],
      ['grammar'],
      ['collocations'],
      ['collocations'],
    ])
  })

  it('asks a number sense for an example and its translation only [spec: work/number-senses]', () => {
    const number = sense('number')
    const gaps = gapsOf([inventory(entryId, [number])], { lemma: 'two' })
    expect(ofSense(gaps, number.id)).toEqual(['examples'])
    expect(gaps.find((gap) => gap.type === 'translations')).toMatchObject({ missing: [{ of: 'sense', id: number.id }] })
  })

  it('needs two examples of each core sense of an A1 or A2 entry [spec: work/core-examples]', () => {
    const nouns = [sense(), sense(), sense(), sense()]
    const facts = [inventory(entryId, nouns), fact('example', nouns[0]?.id as SenseId, { text: 'A bank.' })]
    const examples = (levelRank: number | null) => gapsOf(facts, { levelRank }).filter((gap) => gap.type === 'examples')
    expect(examples(2).map((gap) => [gap.count, gap.need])).toEqual([
      [1, 2],
      [0, 2],
      [0, 2],
      [0, 1],
    ])
    expect(examples(3).map((gap) => [gap.count, gap.need])).toEqual([
      [0, 1],
      [0, 1],
      [0, 1],
    ])
  })
})

describe('entry slots', () => {
  const verb = sense('verb')
  const noun = sense('noun')
  const formsGap = (facts: Fact[], lemma = 'walk') =>
    gapsOf(facts, { lemma }).find((gap): gap is Extract<Gap, { type: 'forms' }> => gap.type === 'forms')

  it('asks for the inflections each part of speech takes, filled by label or by where the form shows [spec: work/form-paradigm]', () => {
    expect(formsGap([inventory(entryId, [verb, noun])])).toEqual({
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
      fact('form', entryId, { form: 'walke', type: 'variant' }),
    ]
    expect(formsGap([inventory(entryId, [verb, noun]), countable, ...forms])).toEqual({
      type: 'forms',
      missing: [
        { type: 'present_participle', pos: 'verb' },
        { type: 'plural', pos: 'noun' },
      ],
    })
    // A form labelled with another part of speech fills nothing here.
    const plural = fact('form', entryId, { form: 'walks', type: 'plural', pos: 'pronoun' })
    expect(formsGap([inventory(entryId, [noun]), countable, plural])?.missing).toEqual([
      { type: 'plural', pos: 'noun' },
    ])
    // An uncountable noun, an invariable word, and a phrase need no form.
    const advice = fact('grammar', noun.id, { countability: 'uncountable' })
    expect(formsGap([inventory(entryId, [noun]), advice], 'advice')).toBeUndefined()
    const jeans = fact('grammar', noun.id, { number: 'plural_only' })
    expect(formsGap([inventory(entryId, [noun]), jeans], 'jeans')).toBeUndefined()
    expect(formsGap([inventory(entryId, [sense('adverb')])], 'ago')).toBeUndefined()
    expect(formsGap([inventory(entryId, [verb])], 'walk out')).toBeUndefined()
  })

  it('asks for comparisons only of a word that compares with -er and -est [spec: work/form-paradigm]', () => {
    const adjective = sense('adjective')
    const listed = inventory(entryId, [adjective])
    const syllables = (...parts: string[]) => fact('syllables', entryId, { syllables: parts })
    const comparison = [
      { type: 'comparative', pos: 'adjective' },
      { type: 'superlative', pos: 'adjective' },
    ]
    expect(formsGap([listed, syllables('big')], 'big')?.missing).toEqual(comparison)
    expect(formsGap([listed, syllables('hap', 'py')], 'happy')?.missing).toEqual(comparison)
    expect(formsGap([listed, syllables('care', 'ful')], 'careful')).toBeUndefined()
    expect(formsGap([listed], 'big')).toBeUndefined()
    // A periphrastic comparison is no inflection: it neither fills a slot nor shows the word compares.
    const periphrastic = fact('form', entryId, { form: 'more careful', type: 'comparative' })
    expect(formsGap([listed, syllables('care', 'ful'), periphrastic], 'careful')).toBeUndefined()
    // A recorded inflected comparison asks for the rest of it, for an adverb too.
    const adverb = inventory(entryId, [sense('adverb')])
    expect(formsGap([adverb], 'soon')).toBeUndefined()
    const sooner = fact('form', entryId, { form: 'sooner', type: 'comparative' })
    expect(formsGap([adverb, sooner], 'soon')?.missing).toEqual([{ type: 'superlative', pos: 'adverb' }])
  })

  it('needs a strong pronunciation in both accents [spec: work/pronunciation-accents]', () => {
    const pronounce = (accent: 'us' | 'uk', strength?: 'weak') =>
      fact('pronunciation', entryId, { ipa: 'tuː', accent, ...(strength ? { strength } : {}) })
    const accents = (facts: Fact[]) =>
      gapsOf([inventory(entryId, [sense('preposition')]), ...facts], { lemma: 'to' }).find(
        (gap) => gap.type === 'pronunciation',
      )
    expect(accents([pronounce('us')])).toEqual({ type: 'pronunciation', accents: ['uk'] })
    expect(accents([pronounce('us'), pronounce('uk', 'weak')])).toEqual({ type: 'pronunciation', accents: ['uk'] })
    expect(accents([pronounce('us'), pronounce('uk')])).toBeUndefined()
  })

  it('asks a pronunciation of each irregular form, given by the form or a pending correction beside it [spec: work/field-gaps]', () => {
    const went = fact('form', entryId, { form: 'went', type: 'past' })
    const gone = fact('form', entryId, { form: 'gone', type: 'past_participle', ipa: 'ɡɔn', accent: 'us' })
    const listed = inventory(entryId, [verb])
    const pronunciations = (facts: Fact[]) =>
      gapsOf([listed, ...facts], { lemma: 'go' }).find((gap) => gap.type === 'form_pronunciations')
    expect(pronunciations([went, gone])).toEqual({ type: 'form_pronunciations', forms: ['went'] })
    const corrected = fact('form', entryId, { form: 'went', type: 'past', ipa: 'wɛnt', accent: 'us' }, 'pending', {
      supersedesId: went.id,
    })
    expect(pronunciations([went, corrected, gone])).toBeUndefined()
    // A regular form needs none.
    expect(pronunciations([fact('form', entryId, { form: 'goes', type: 'third_person_singular' })])).toBeUndefined()
  })

  it('asks an A1 or A2 single word for a word family member, filled by a linked derivative [spec: work/family-gap]', () => {
    const listed = [inventory(entryId, [noun])]
    expect(typesOf(gapsOf(listed, { levelRank: 2 }))).toContain('family')
    expect(typesOf(gapsOf(listed, { levelRank: 3 }))).not.toContain('family')
    expect(typesOf(gapsOf(listed, { levelRank: 1, family: ['banker'] }))).not.toContain('family')
    expect(typesOf(gapsOf(listed, { levelRank: 1, lemma: 'bank on' }))).not.toContain('family')
  })

  it('asks every inventoried single word for its phrases list, filled by one live list [spec: work/phrases-gap]', () => {
    const listed = [inventory(entryId, [verb])]
    expect(typesOf(gapsOf(listed, { lemma: 'give' }))).toContain('phrases')
    const phrases = fact('phrases', entryId, { phrases: ['give up', 'give in'] }, 'pending')
    expect(typesOf(gapsOf([...listed, phrases], { lemma: 'give' }))).not.toContain('phrases')
    const rejected = fact('phrases', entryId, { phrases: ['give it'] }, 'rejected')
    expect(typesOf(gapsOf([...listed, rejected], { lemma: 'give' }))).toContain('phrases')
  })
})

describe('slot passes', () => {
  it('closes an optional slot a pass found nothing for, and any slot a curator settled, counting it filled [spec: work/optional-pass]', () => {
    const noun = sense()
    const facts = [inventory(entryId, [noun])]
    const passes = new Set([passKey('category', noun.id), passKey('phrases', entryId), passKey('syllables', entryId)])
    const open = assessEntry(snapshot(facts))
    const passed = assessEntry(snapshot(facts, { passes }))
    const types = (work: OpenWork[]) => work.map((piece) => piece.gap.type)
    expect(types(open.work)).toEqual(expect.arrayContaining(['category', 'phrases', 'syllables']))
    expect(types(passed.work)).not.toContain('category')
    expect(types(passed.work)).not.toContain('phrases')
    expect(types(passed.work)).not.toContain('syllables')
    expect(passed.slots.total).toBe(open.slots.total)
    expect(passed.completeness).toBeGreaterThan(open.completeness)
    // A pass on another node closes nothing here.
    const elsewhere = assessEntry(snapshot(facts, { passes: new Set([passKey('category', shown.id)]) }))
    expect(types(elsewhere.work)).toContain('category')
  })
})

describe('assessEntry', () => {
  const noun = sense()
  const listed = inventory(entryId, [noun])
  const review = (reviewer: Review['reviewer']): Review => ({
    reviewer,
    model: 'm',
    verdict: 'pass',
    confidence: 0.9,
    reason: '',
    context: {},
    detail: {},
    reviewed_at: at,
  })

  it('scores completeness as filled slots over the slots the rules count [spec: work/scores]', () => {
    // Entry: senses, two accents, phrases, morphology, syllables, one translation; sense: category,
    // synonyms, example, topic, grammar, collocation.
    const bare = assessEntry(snapshot([listed]))
    expect(bare.slots.total).toBe(13)
    expect(bare.completeness).toBeCloseTo(1 / 13)
    // Without an inventory the inventory is the entry's only slot.
    expect(assessEntry(snapshot([])).slots.total).toBe(1)
    expect(assessEntry(snapshot([])).completeness).toBe(0)
  })

  it('counts the slots published facts fill and the ones only pending facts fill [spec: work/slot-counts]', () => {
    const pending = fact('morphology', entryId, { parts: [{ form: 'bank', role: 'base' }] }, 'pending')
    expect(assessEntry(snapshot([listed, pending])).slots).toEqual({ total: 13, published: 1, pending: 1 })
    // A pending inventory fills only in the live view.
    expect(assessEntry(snapshot([inventory(entryId, [noun], 'pending')])).slots).toEqual({
      total: 13,
      published: 0,
      pending: 1,
    })
  })

  it('scores credibility as the weakest published fact or empty optional pass [spec: work/credibility]', () => {
    const credibility = (facts: Fact[], passes: string[] = []) =>
      assessEntry(snapshot(facts, { passes: new Set(passes) })).credibility
    expect(credibility([listed])).toBe(1)
    const judged = (reviewer: Review['reviewer'], status: FactStatus = 'published') =>
      fact('morphology', entryId, { parts: [{ form: 'bank', role: 'base' }] }, status, { review: review(reviewer) })
    expect(credibility([judged('curator')])).toBe(1)
    expect(credibility([judged('jev')])).toBe(0.97)
    expect(credibility([judged('jev'), judged('jev+llm')])).toBe(0.88)
    expect(credibility([judged('llm')])).toBe(0.99)
    // Only published facts count.
    expect(credibility([judged('jev+llm', 'rejected')])).toBe(1)
    // An optional slot left empty ranks low; a curator's pass on a required slot does not.
    expect(credibility([judged('jev')], [passKey('synonyms', noun.id)])).toBe(0.8)
    expect(credibility([judged('jev')], [passKey('syllables', entryId)])).toBe(0.97)
  })

  it('awaits review exactly where a pending fact changes the open work, and lists none for a dead entry [spec: work/awaiting-review]', () => {
    const pending = fact('morphology', entryId, { parts: [{ form: 'bank', role: 'base' }] }, 'pending')
    const example = fact('example', noun.id, { text: 'A bank.' }, 'pending')
    const { work } = assessEntry(snapshot([listed, pending, example]))
    const awaiting = work.filter((piece) => piece.awaiting).map((piece) => piece.gap.type)
    // The pending example also asks for its translation.
    expect(awaiting).toEqual(['translations', 'morphology', 'examples'])
    // The settled view of a gap the pending facts close is what awaits.
    expect(work.find((piece) => piece.gap.type === 'morphology')).toEqual({
      gap: { type: 'morphology' },
      subjectId: entryId,
      awaiting: true,
    })
    expect(work.find((piece) => piece.gap.type === 'synonyms')).toEqual({
      gap: { type: 'synonyms', sense_id: noun.id },
      subjectId: noun.id,
      awaiting: false,
    })
    const dead = assessEntry({ ...snapshot([listed]), entry: { id: entryId, lemma: 'bank', live: false } })
    expect(dead.work).toEqual([])
  })
})

describe('gaps as items', () => {
  const senseId = id<SenseId>()

  it('names the node a gap is about and how many facts it still needs', () => {
    expect(subjectOf({ type: 'grammar', sense_id: senseId }, entryId)).toBe(senseId)
    expect(subjectOf({ type: 'syllables' }, entryId)).toBe(entryId)
    expect(
      [
        { type: 'forms', missing: [{ type: 'past', pos: 'verb' }] },
        { type: 'pronunciation', accents: ['us', 'uk'] },
        { type: 'form_pronunciations', forms: ['went', 'gone', 'goes'] },
        { type: 'translations', language: 'zh', missing: [] },
        { type: 'examples', sense_id: senseId, count: 1, need: 2 },
        { type: 'senses' },
      ].map((gap) => missingOf(gap as Gap)),
    ).toEqual([1, 2, 3, 0, 1, 1])
  })

  it('compares gaps by what they say, whatever their key order', () => {
    expect(gapText({ type: 'examples', sense_id: senseId, count: 0, need: 1 })).toBe(
      gapText({ need: 1, count: 0, sense_id: senseId, type: 'examples' } as Gap),
    )
    expect(gapText(undefined)).toBe('null')
  })
})

describe('work lease', () => {
  const lease: Pick<WorkLease, 'holder' | 'expiresAt'> = { holder: 'agent:a', expiresAt: '2026-01-01T00:15:00.000Z' }

  it('expires lease_seconds after the claim', () => {
    expect(leaseExpiry(new Date(at), 900)).toBe('2026-01-01T00:15:00.000Z')
  })

  it('lets only the holder complete before expiry', () => {
    expect(completeDecision(lease, 'agent:a', new Date('2026-01-01T00:10:00.000Z'))).toBe('allowed')
    expect(completeDecision(lease, 'agent:b', new Date('2026-01-01T00:10:00.000Z'))).toBe('not_holder')
    expect(completeDecision(lease, 'agent:a', new Date('2026-01-01T00:15:00.000Z'))).toBe('expired')
  })
})

describe('work items', () => {
  const senseId = id<SenseId>()
  const learner = { batch: 1, levelRank: 3, zipf: 4.2 }
  const item = (gap: Gap, over: Partial<WorkItem> = {}): WorkItem => ({
    id: id<WorkItemId>(),
    entryId,
    type: gap.type,
    subjectId: subjectOf(gap, entryId),
    gap,
    ...workPriority(gap.type, learner),
    awaiting: false,
    attempts: 0,
    worked: false,
    foundNone: false,
    claimedGap: null,
    lease: null,
    lastWorkedAt: null,
    lastWorkedBy: null,
    lastNote: null,
    ...over,
  })
  const work = (gap: Gap, awaiting = false): OpenWork => ({ gap, subjectId: subjectOf(gap, entryId), awaiting })
  const examples = (count: number): Gap => ({ type: 'examples', sense_id: senseId, count, need: 2 })

  it("ranks by batch, then band, A1 to C2 then no level; the stage only orders one entry's work [spec: work/item-priority]", () => {
    expect([1, 6, null].map((levelRank) => learnerBand({ levelRank }))).toEqual([0, 5, 6])
    const rank = (type: WorkType, levelRank: number | null, batch = 1) =>
      workPriority(type, { batch, levelRank, zipf: null }).rank
    // Every stage of a band ranks alike, and before any work of the next band.
    expect(rank('morphology', 1)).toBe(rank('senses', 1))
    expect(rank('morphology', 1)).toBeLessThan(rank('senses', 2))
    expect(rank('translations', 6)).toBeLessThan(rank('senses', null))
    // A later batch waits for every item of the earlier one.
    expect(rank('morphology', null, 1)).toBeLessThan(rank('senses', 1, 2))
    expect(workPriority('senses', learner)).toMatchObject({ stage: WORK_POLICY.senses.stage, zipfOrder: 4.2 })
    expect(workPriority('morphology', learner).stage).toBeGreaterThan(workPriority('senses', learner).stage)
    expect(workPriority('senses', { ...learner, zipf: null }).zipfOrder).toBe(-1)
  })

  it('upserts the open work by type and node and deletes the rest [spec: work/item-upsert]', () => {
    const kept = item({ type: 'syllables' }, { attempts: 1 })
    const gone = item({ type: 'morphology' })
    const result = reconcileItems([kept, gone], [work({ type: 'syllables' }), work({ type: 'phrases' })], learner)
    expect(result.writes).toEqual([
      expect.objectContaining({ id: kept.id, type: 'syllables', attempts: 1, worked: false, foundNone: false }),
      expect.objectContaining({ id: null, type: 'phrases', subjectId: entryId, attempts: 0, awaiting: false }),
    ])
    expect(result.deletes).toEqual([gone.id])
    expect(result.verdicts).toEqual([])
  })

  it('keeps a worked item and its pending verdict while it awaits review [spec: work/attempt-verdicts]', () => {
    const worked = item(examples(0), { worked: true, foundNone: true, attempts: 1, claimedGap: examples(0) })
    const result = reconcileItems([worked], [work(examples(0), true)], learner)
    expect(result.writes[0]).toMatchObject({
      id: worked.id,
      awaiting: true,
      worked: true,
      foundNone: true,
      attempts: 1,
    })
    expect(result.verdicts).toEqual([])
  })

  it('judges each worked item once settled: progress resets, no progress counts an attempt [spec: work/item-attempts]', () => {
    const progressed = item(examples(1), { worked: true, attempts: 1, claimedGap: examples(0) })
    const stalled = item({ type: 'syllables' }, { worked: true, claimedGap: { type: 'syllables' } })
    const unclaimed = item({ type: 'morphology' }, { worked: true })
    const result = reconcileItems(
      [progressed, stalled, unclaimed],
      [work(examples(1)), work({ type: 'syllables' }), work({ type: 'morphology' })],
      learner,
    )
    expect(result.writes.map(({ id, attempts, worked }) => [id, attempts, worked])).toEqual([
      [progressed.id, 0, false],
      [stalled.id, 1, false],
      [unclaimed.id, 0, false],
    ])
    expect(result.verdicts.map(({ id, verdict }) => [id, verdict])).toEqual([
      [progressed.id, 'progressed'],
      [stalled.id, 'no_progress'],
      [unclaimed.id, 'progressed'],
    ])
  })

  it('counts a pass as progress when it filled a slot its claim found, even if others opened new ones [spec: work/item-attempts]', () => {
    const target = (id: string) => ({ of: 'example' as const, id: id as FactId })
    const translations = (...ids: string[]) => ({
      type: 'translations' as const,
      language: 'zh' as const,
      missing: ids.map(target),
    })
    // The pass translated a while other passes added c and d: more missing, yet a slot it was given is filled.
    expect(filledSince(translations('a', 'b'), translations('b', 'c', 'd'))).toBe(true)
    expect(filledSince(translations('a', 'b'), translations('a', 'b', 'c'))).toBe(false)
    expect(filledSince(examples(0), examples(1))).toBe(true)
    expect(filledSince(examples(1), examples(1))).toBe(false)
    expect(filledSince({ type: 'syllables' }, { type: 'syllables' })).toBe(false)
  })

  it('makes an item a ticket once its passes reach the bound [spec: work/item-curation]', () => {
    expect(MAX_PASSES).toBe(2)
    const second = item({ type: 'syllables' }, { worked: true, attempts: 1, claimedGap: { type: 'syllables' } })
    const result = reconcileItems([second], [work({ type: 'syllables' })], learner)
    expect(result.writes[0]).toMatchObject({ attempts: 2 })
    expect(result.verdicts).toEqual([{ id: second.id, verdict: 'stuck', type: 'syllables', subjectId: entryId }])
    expect(itemState({ attempts: 2, awaiting: true })).toBe('ticket')
    expect(itemState({ attempts: 1, awaiting: true })).toBe('awaiting_review')
    expect(itemState({ attempts: 1, awaiting: false })).toBe('open')
  })

  it('completes an optional slot whose pass found none, but not a required one [spec: work/optional-pass]', () => {
    const optional = item({ type: 'synonyms', sense_id: senseId }, { worked: true, foundNone: true })
    const required = item({ type: 'syllables' }, { worked: true, foundNone: true, claimedGap: { type: 'syllables' } })
    const result = reconcileItems(
      [optional, required],
      [work({ type: 'synonyms', sense_id: senseId }), work({ type: 'syllables' })],
      learner,
    )
    expect(result.writes.map((write) => write.id)).toEqual([required.id])
    expect(result.deletes).toEqual([optional.id])
    expect(result.verdicts.map(({ id, verdict }) => [id, verdict])).toEqual([
      [optional.id, 'passed'],
      [required.id, 'no_progress'],
    ])
  })

  it('closes a worked item whose gap is gone, and deletes an unworked one without a verdict [spec: work/attempt-verdicts]', () => {
    const worked = item({ type: 'syllables' }, { worked: true })
    const idle = item({ type: 'morphology' })
    const result = reconcileItems([worked, idle], [], learner)
    expect(result.deletes).toEqual([worked.id, idle.id])
    expect(result.verdicts).toEqual([{ id: worked.id, verdict: 'closed', type: 'syllables', subjectId: entryId }])
  })
})
