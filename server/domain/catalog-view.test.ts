import type { EntryId, FactId, FactKind, FactPayloads, FactStatus, Pos, SenseId, TopicId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import {
  type EntrySnapshot,
  type ProjectionContext,
  projectPublicEntry,
  publicFactIds,
  reviewOf,
  type StoredEntry,
} from './catalog-view'
import type { Fact, FactOf } from './fact'
import { formClasses } from './fact-kinds'
import type { EntryNode, SenseWithLemma } from './nodes'
import type { Lemma } from './term'

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
    review:
      status === 'published'
        ? {
            reviewer: 'jev',
            model: 'm',
            verdict: 'uncertain',
            confidence: 0.6,
            reason: 'r',
            context: {},
            detail: {},
            reviewed_at: at,
          }
        : null,
    revalidateSince: null,
    createdAt: at,
    updatedAt: at,
  }
}

function bankWorld() {
  const bank = entry('bank')
  const shore = entry('shore')
  const bankSense = sense(bank)
  const shoreSense = sense(shore)
  const facts: Fact[] = [
    fact('entry', bank.id, {}),
    fact('sense', bankSense.id, { gloss: 'land beside a river' }),
    fact('form', bank.id, { form: 'banks', type: 'plural' }),
    fact('form', bank.id, { form: 'bankes', type: 'variant' }, 'rejected'),
    fact('pronunciation', bank.id, { ipa: 'bæŋk', accent: 'us' }),
    fact('example', bankSense.id, { text: 'We sat on the bank.' }),
    fact('example', bankSense.id, { text: 'Pending example.' }, 'pending'),
    fact('translation', bankSense.id, { language: 'fr', text: 'rive' }),
    fact('relation', bankSense.id, { type: 'synonym', target_sense_id: shoreSense.id }),
  ]
  const neighborFacts: Fact[] = [
    fact('entry', shore.id, {}),
    fact('sense', shoreSense.id, { gloss: 'land along water' }),
  ]
  const snapshot: EntrySnapshot = {
    entry: bank,
    flagged: new Set(),
    seed: false,
    senses: [bankSense],
    facts,
    incoming: [],
    neighbors: { senses: [shoreSense], facts: neighborFacts },
  }
  return { bank, shore, bankSense, shoreSense, snapshot, neighborFacts }
}

const context: ProjectionContext = {
  reference: { frequency: null, cefr: [] },
  topicNames: new Map([['kitchen' as TopicId, { en: 'In the kitchen', zh: '厨房' }]]),
}
const project = (snapshot: EntrySnapshot, with_: Partial<ProjectionContext> = {}) =>
  projectPublicEntry(snapshot, { ...context, ...with_ })
const review = (of: Fact) => ({ fact_id: of.id, confidence: 0.6, verdict: 'uncertain' })
const senses = (view: StoredEntry | null) => view?.meanings.flatMap((meaning) => meaning.senses) ?? []
const firstSense = (view: StoredEntry | null) => senses(view)[0]

/** Another entry with one published noun sense, for relations. */
function neighbor(lemma: string, gloss: string, pos: Pos = 'noun') {
  const node = entry(lemma)
  const one = sense(node, pos)
  return { node, sense: one, facts: [fact('entry', node.id, {}), fact('sense', one.id, { gloss })] }
}

describe('public read model', () => {
  it('shows published grammar, word formation, and collocations [spec: catalog/usage-facts]', () => {
    const { snapshot, bank, bankSense } = bankWorld()
    const morphology = fact('morphology', bank.id, { parts: [{ form: 'bank', role: 'base' }] })
    const grammar = fact('grammar', bankSense.id, { countability: 'countable' })
    const collocation = fact('collocation', bankSense.id, { text: 'river bank', pattern: 'noun_noun' })
    const usage: EntrySnapshot = {
      ...snapshot,
      facts: [
        ...snapshot.facts,
        morphology,
        grammar,
        fact('grammar', bankSense.id, { countability: 'both' }, 'pending'),
        collocation,
        fact('collocation', bankSense.id, { text: 'steep bank', pattern: 'adjective_noun' }, 'rejected'),
      ],
    }
    const view = project(usage)
    expect(view?.morphology).toEqual({ parts: [{ form: 'bank', role: 'base' }], review: review(morphology) })
    expect(firstSense(view)?.grammar).toEqual({
      countability: 'countable',
      patterns: [],
      prepositions: [],
      review: review(grammar),
    })
    expect(firstSense(view)?.collocations).toEqual([
      { text: 'river bank', pattern: 'noun_noun', review: review(collocation) },
    ])
    const ids = view ? publicFactIds(view) : new Set()
    expect([morphology.id, grammar.id, collocation.id].every((factId) => ids.has(factId))).toBe(true)
    const bare = project(snapshot)
    expect([bare?.morphology, firstSense(bare)?.grammar, firstSense(bare)?.collocations]).toEqual([null, null, []])
  })

  it('groups senses into meanings in sense-list order, rare after common [spec: catalog/sense-order]', () => {
    const { snapshot, bank, bankSense } = bankWorld()
    const [money, rely, oars, added] = [sense(bank), sense(bank, 'verb'), sense(bank), sense(bank, 'adjective')]
    const glossed = [
      fact('sense', money.id, { gloss: 'An institution that keeps money.' }),
      fact('sense', rely.id, { gloss: 'To rely on.' }),
      fact('sense', oars.id, { gloss: 'A row of oars.' }),
      fact('sense', added.id, { gloss: 'Of a bank.' }),
    ]
    // A list may still name a sense whose gloss was since retracted: it is not shown.
    const gone = id<SenseId>()
    const published = fact('sense_list', bank.id, { common: [rely.id, money.id, gone, bankSense.id], extra: [oars.id] })
    const pending = fact('sense_list', bank.id, { common: [bankSense.id], extra: [] }, 'pending')
    const listed: EntrySnapshot = {
      ...snapshot,
      senses: [bankSense, added, oars, money, rely],
      facts: [...snapshot.facts, ...glossed, published, pending],
    }
    const view = project(listed)
    expect(view?.meanings.map((meaning) => [meaning.pos, meaning.senses.map((one) => [one.id, one.rare])])).toEqual([
      ['verb', [[rely.id, false]]],
      [
        'noun',
        [
          [money.id, false],
          [bankSense.id, false],
          [oars.id, true],
        ],
      ],
      ['adjective', [[added.id, false]]],
    ])
    expect(view?.review.sense_list).toEqual(review(published))
    expect(view ? publicFactIds(view).has(published.id) : false).toBe(true)
    const unlisted = project({ ...listed, facts: [...snapshot.facts, ...glossed, pending] })
    expect(unlisted?.review.sense_list).toBeNull()
    expect(unlisted?.meanings.map((meaning) => meaning.pos)).toEqual(['noun', 'adjective', 'verb'])
    expect(senses(unlisted).map((one) => one.rare)).toEqual([false, false, false, false, false])
  })

  it('shows only published facts, each with its review [spec: catalog/visibility]', () => {
    const { snapshot, bank, bankSense, shoreSense } = bankWorld()
    const view = project(snapshot)
    expect(view?.meanings[0]?.forms).toEqual({ plural: ['banks'] })
    expect(view?.variants).toEqual([])
    expect(view?.pronunciations).toEqual([
      { ipa: 'bæŋk', accent: 'us', review: expect.objectContaining({ verdict: 'uncertain' }) },
    ])
    expect(senses(view)).toHaveLength(1)
    const only = firstSense(view)
    expect(only).toMatchObject({ id: bankSense.id, gloss: 'land beside a river', labels: [], rare: false })
    expect(only?.review.gloss).toMatchObject({ verdict: 'uncertain', confidence: 0.6 })
    expect(only?.examples.map((example) => example.text)).toEqual(['We sat on the bank.'])
    expect(only?.translations).toEqual({ fr: ['rive'] })
    expect(only?.relations.synonyms).toEqual([
      expect.objectContaining({ lemma: 'shore', sense_id: shoreSense.id, gloss: 'land along water' }),
    ])
    const entryFact = snapshot.facts.find((one) => one.kind === 'entry') as Fact
    expect(view?.review.entry).toEqual(review(entryFact))
    expect(view?.id).toBe(bank.id)
  })

  it('splits pronunciations, forms, variants, and labels the way a learner reads them [spec: catalog/meaning-shape] [spec: facts/write-labels]', () => {
    const { snapshot, bank, bankSense } = bankWorld()
    const tilt = sense(bank, 'verb')
    const neat = sense(bank, 'adjective')
    const facts = [
      fact('entry', bank.id, {}),
      fact('sense', bankSense.id, { gloss: 'Land beside a river.' }),
      fact('sense', tilt.id, { gloss: 'To tilt an aircraft.', register: 'technical' }),
      fact('sense', neat.id, { gloss: 'Neat.', register: 'informal' }),
      fact('pronunciation', bank.id, { ipa: 'bæŋk', accent: 'us' }),
      fact('pronunciation', bank.id, { ipa: 'bæŋk', accent: 'uk', strength: 'weak' }),
      fact('pronunciation', bank.id, { ipa: 'bɛŋk', accent: 'us', pos: 'verb' }),
      fact('pronunciation', bank.id, { ipa: 'bɑŋk', accent: 'us', pos: 'adverb' }),
      fact('form', bank.id, { form: 'banks', type: 'plural' }),
      fact('form', bank.id, { form: 'banked', type: 'past' }),
      fact('form', bank.id, { form: 'bankt', type: 'past', pos: 'verb' }),
      fact('form', bank.id, { form: 'banker', type: 'comparative' }),
      fact('form', bank.id, { form: 'banka', type: 'plural', pos: 'pronoun' }),
      fact('form', bank.id, { form: 'banque', type: 'variant' }),
      fact('form', bank.id, { form: 'bancque', type: 'variant', pos: 'noun' }),
    ]
    const view = project({ ...snapshot, senses: [bankSense, tilt, neat], facts })
    expect(view?.pronunciations.map(({ ipa, accent, strength }) => ({ ipa, accent, strength }))).toEqual([
      { ipa: 'bæŋk', accent: 'us', strength: undefined },
      { ipa: 'bæŋk', accent: 'uk', strength: 'weak' },
    ])
    const [noun, verb, adjective] = view?.meanings ?? []
    expect(noun?.pronunciations).toEqual([])
    expect(verb?.pronunciations).toEqual([{ ipa: 'bɛŋk', accent: 'us', review: expect.anything() }])
    expect([noun?.forms, verb?.forms, adjective?.forms]).toEqual([
      { plural: ['banks'] },
      { past: ['banked', 'bankt'] },
      { comparative: ['banker'] },
    ])
    expect(verb?.review.forms.past).toHaveLength(2)
    expect(view?.variants.map(({ form, pos }) => ({ form, pos }))).toEqual([
      { form: 'banque', pos: undefined },
      { form: 'bancque', pos: 'noun' },
    ])
    expect(senses(view).map((one) => one.labels)).toEqual([[], ['technical'], ['informal']])
    // A form or pronunciation of a part of speech no public sense has is not shown, nor public.
    const hidden = facts.filter((one) =>
      ['bɑŋk', 'banka'].includes(
        (one.payload as { ipa?: string; form?: string }).ipa ?? (one.payload as { form?: string }).form ?? '',
      ),
    )
    const ids = view ? publicFactIds(view) : new Set()
    expect(hidden.map((one) => ids.has(one.id))).toEqual([false, false])
  })

  it('groups relations by what they say about each end [spec: catalog/relation-groups]', () => {
    const { snapshot, bank, bankSense } = bankWorld()
    const others = {
      shore: neighbor('shore', 'Land along water.'),
      sea: neighbor('sea', 'Open water.'),
      land: neighbor('land', 'Ground.'),
      edge: neighbor('edge', 'A border.'),
      river: neighbor('river', 'Flowing water.'),
      mud: neighbor('mud', 'Wet earth.'),
      dune: neighbor('dune', 'A hill of sand.'),
    }
    const relation = (type: FactPayloads['relation']['type'], from: SenseId, to: SenseId) =>
      fact('relation', from, { type, target_sense_id: to })
    const outgoing = [
      relation('synonym', bankSense.id, others.shore.sense.id),
      relation('hypernym', bankSense.id, others.land.sense.id),
      relation('part_of', bankSense.id, others.river.sense.id),
    ]
    const incoming = [
      relation('antonym', others.sea.sense.id, bankSense.id),
      relation('hypernym', others.dune.sense.id, bankSense.id),
      relation('part_of', others.edge.sense.id, bankSense.id),
      relation('synonym', others.mud.sense.id, bankSense.id),
    ]
    const all = Object.values(others)
    const view = project({
      ...snapshot,
      facts: [fact('entry', bank.id, {}), fact('sense', bankSense.id, { gloss: 'Land beside a river.' }), ...outgoing],
      incoming,
      neighbors: { senses: all.map((one) => one.sense), facts: all.flatMap((one) => one.facts) },
    })
    const lemmas = Object.fromEntries(
      Object.entries(firstSense(view)?.relations ?? {}).map(([group, related]) => [
        group,
        related.map((one) => one.lemma),
      ]),
    )
    expect(lemmas).toEqual({
      synonyms: ['shore', 'mud'],
      antonyms: ['sea'],
      broader: ['land'],
      narrower: ['dune'],
      part_of: ['river'],
      parts: ['edge'],
    })
    expect(firstSense(view)?.relations.broader).toEqual([
      { lemma: 'land', sense_id: others.land.sense.id, gloss: 'Ground.', review: review(outgoing[1] as Fact) },
    ])
  })

  it('keeps every language and names each topic, with the first translation in the summary', () => {
    const { snapshot, bankSense } = bankWorld()
    const facts = [
      ...snapshot.facts,
      fact('translation', bankSense.id, { language: 'zh', text: '河岸' }),
      fact('translation', bankSense.id, { language: 'zh', text: '岸' }),
      fact('topic', bankSense.id, { topic_id: 'kitchen' as TopicId }),
    ]
    const view = project(
      { ...snapshot, facts },
      {
        reference: {
          frequency: { zipf: 5, rank: 900, source_id: 'freq' },
          cefr: [
            { pos: 'noun', level: 'B1', source_id: 'c' },
            { pos: 'verb', level: 'A2', source_id: 'c' },
            { pos: 'adverb', level: 'C1', source_id: 'c' },
          ],
        },
      },
    )
    expect(firstSense(view)?.translations).toEqual({ fr: ['rive'], zh: ['河岸', '岸'] })
    expect(firstSense(view)?.review.translations.zh).toHaveLength(2)
    expect(firstSense(view)?.topics).toEqual([
      { id: 'kitchen', name: { en: 'In the kitchen', zh: '厨房' }, review: expect.anything() },
    ])
    expect(view?.frequency).toEqual({ zipf: 5, rank: 900 })
    expect(view?.meanings[0]?.cefr).toBe('B1')
    expect(view?.summary).toEqual({
      lemma: 'bank',
      pos: ['noun'],
      cefr: 'A2',
      gloss: 'land beside a river',
      translations: { fr: 'rive', zh: '河岸' },
    })
    expect(() => project({ ...snapshot, facts }, { topicNames: new Map() })).toThrow('does not exist')
  })

  it('summarizes an entry without public senses', () => {
    const { bank } = bankWorld()
    const view = project({
      entry: bank,
      flagged: new Set(),
      seed: false,
      senses: [],
      facts: [fact('entry', bank.id, {})],
      incoming: [],
      neighbors: { senses: [], facts: [] },
    })
    expect(view?.meanings).toEqual([])
    expect(view?.summary).toEqual({ lemma: 'bank', pos: [], cefr: null, gloss: null, translations: {} })
  })

  it('hides an entry whose entry fact is not published', () => {
    const { snapshot } = bankWorld()
    const hidden = {
      ...snapshot,
      facts: snapshot.facts.map((f) => (f.kind === 'entry' ? { ...f, status: 'pending' as const } : f)),
    }
    expect(project(hidden)).toBeNull()
  })

  it('hides a relation until both endpoint senses and their entries are published [spec: catalog/relation-visibility]', () => {
    const { snapshot, neighborFacts } = bankWorld()
    const unpublish = (kind: FactKind) => ({
      ...snapshot,
      neighbors: {
        ...snapshot.neighbors,
        facts: neighborFacts.map((f) => (f.kind === kind ? { ...f, status: 'pending' as const } : f)),
      },
    })
    expect(firstSense(project(unpublish('entry')))?.relations.synonyms).toEqual([])
    expect(firstSense(project(unpublish('sense')))?.relations.synonyms).toEqual([])
    const unknownTarget = { ...snapshot, neighbors: { senses: [], facts: [] } }
    expect(firstSense(project(unknownTarget))?.relations.synonyms).toEqual([])
  })

  it('shows a relation pointing at a sense from its other end', () => {
    const { shore, shoreSense, bankSense, snapshot } = bankWorld()
    const relation = snapshot.facts.find((f) => f.kind === 'relation') as Fact
    const fromShore: EntrySnapshot = {
      entry: shore,
      flagged: new Set(),
      seed: false,
      senses: [shoreSense],
      facts: [fact('entry', shore.id, {}), fact('sense', shoreSense.id, { gloss: 'land along water' })],
      incoming: [relation],
      neighbors: {
        senses: [bankSense],
        facts: snapshot.facts.filter((f) => f.kind === 'entry' || f.kind === 'sense'),
      },
    }
    expect(firstSense(project(fromShore))?.relations.synonyms).toEqual([
      expect.objectContaining({ lemma: 'bank', sense_id: bankSense.id }),
    ])
    const hiddenSource = { ...fromShore, neighbors: { senses: [bankSense], facts: [] } }
    expect(firstSense(project(hiddenSource))?.relations.synonyms).toEqual([])
  })

  it('places a form under the parts of speech of its label or type', () => {
    expect(formClasses('plural', undefined)).toEqual(['noun'])
    expect(formClasses('comparative', undefined)).toEqual(['adjective', 'adverb'])
    expect(formClasses('past', 'auxiliary')).toEqual(['auxiliary'])
    expect(formClasses('variant', undefined)).toEqual([])
  })

  it('refuses the review of unreviewed facts', () => {
    const { bank } = bankWorld()
    expect(() => reviewOf(fact('form', bank.id, { form: 'x', type: 'plural' }, 'pending'))).toThrow('not a reviewed')
  })
})
