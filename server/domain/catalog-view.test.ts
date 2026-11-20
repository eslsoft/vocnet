import type {
  EntryId,
  FactId,
  FactKind,
  FactPayloads,
  FactStatus,
  Pos,
  SenseId,
  SentenceId,
  StoredInventorySense,
  TopicId,
} from '@shared/facts'
import { describe, expect, it } from 'vitest'
import {
  type EntrySnapshot,
  managedEntryView,
  type ProjectionContext,
  projectPublicEntry,
  publicFactIds,
  reviewOf,
  type StoredEntry,
} from './catalog-view'
import type { Fact, FactOf } from './fact'
import { formMeaning } from './fact-kinds'
import type { EntryNode, SenseNode, SentenceNode } from './nodes'
import type { Lemma } from './term'

let counter = 0
const id = <T>() => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` as T
const at = '2026-01-01T00:00:00.000Z'

const entry = (lemma: string): EntryNode & { live: boolean } => ({
  id: id<EntryId>(),
  lemma: lemma as Lemma,
  createdBy: 'agent:a',
  createdAt: at,
  live: true,
})
const senseNode = (of: EntryNode, sense: StoredInventorySense): SenseNode => ({
  id: sense.id,
  entryId: of.id,
  pos: sense.pos,
  createdBy: 'agent:a',
  createdAt: at,
})
const inventorySense = (
  gloss: string,
  pos: Pos = 'noun',
  extra: Partial<StoredInventorySense> = {},
): StoredInventorySense => ({ id: id<SenseId>(), pos, gloss, rank: 'common', ...extra })

/** Every sentence the tests made, as a snapshot reads them. */
const sentences = new Map<SentenceId, SentenceNode>()
const sentence = (text: string): SentenceId => {
  const node: SentenceNode = { id: id<SentenceId>(), text, source: null, createdBy: 'agent:a' as never, createdAt: at }
  sentences.set(node.id, node)
  return node.id
}

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
    objectId:
      kind === 'relation'
        ? (payload as FactPayloads['relation']).target_sense_id
        : kind === 'example'
          ? (payload as FactPayloads['example']).sentence_id
          : null,
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
    createdAt: at,
    updatedAt: at,
  }
}
const inventory = (of: EntryNode, senses: StoredInventorySense[], status: FactStatus = 'published') =>
  fact('senses', of.id, { senses }, status)

/** Another live entry with one published noun sense, for relations. */
function neighbor(lemma: string, gloss: string) {
  const node = entry(lemma)
  const sense = inventorySense(gloss)
  return { node, sense, inventory: inventory(node, [sense]) }
}
type Neighbor = ReturnType<typeof neighbor>
const neighborsOf = (...others: Neighbor[]): EntrySnapshot['neighbors'] => ({
  inventories: others.map((other) => other.inventory),
  lemmas: new Map(others.map((other) => [other.node.id, other.node.lemma])),
  liveEntries: new Set(others.map((other) => other.node.id)),
})

function snapshotOf(
  node: EntryNode & { live: boolean },
  facts: Fact[],
  more: Partial<EntrySnapshot> = {},
): EntrySnapshot {
  const senses = facts
    .filter((one): one is FactOf<'senses'> => one.kind === 'senses')
    .flatMap((one) => one.payload.senses.map((sense) => senseNode(node, sense)))
  return {
    entry: node,
    batch: 1,
    levelRank: null,
    zipf: null,
    family: [],
    phraseType: null,
    sentences,
    phraseEntries: new Map(),
    senses,
    facts,
    incoming: [],
    passes: new Set(),
    neighbors: neighborsOf(),
    ...more,
  }
}

function bankWorld() {
  const bank = entry('bank')
  const shore = neighbor('shore', 'land along water')
  const river = inventorySense('land beside a river')
  const bankInventory = inventory(bank, [river])
  const sat = sentence('We sat on the bank.')
  const example = fact('example', river.id, { sentence_id: sat })
  const facts: Fact[] = [
    bankInventory,
    inventory(bank, [inventorySense('a pending replacement')], 'pending'),
    fact('form', bank.id, { form: 'banks', type: 'plural' }),
    fact('form', bank.id, { form: 'bankes', type: 'variant' }, 'rejected'),
    fact('pronunciation', bank.id, { ipa: 'bæŋk', accent: 'us' }),
    example,
    fact('example', river.id, { sentence_id: sentence('Pending example.') }, 'pending'),
    fact('translation', river.id, { language: 'zh', of: 'sense', text: '河岸' }),
    fact('translation', river.id, { language: 'zh', of: 'sense', text: '岸边' }, 'pending'),
    fact('translation', sat, { language: 'zh', of: 'sentence', text: '我们坐在河岸上。' }),
    fact('relation', river.id, { type: 'synonym', target_sense_id: shore.sense.id }),
  ]
  const snapshot = snapshotOf(bank, facts, { neighbors: neighborsOf(shore) })
  return { bank, shore, river, bankInventory, example, snapshot }
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

describe('public read model', () => {
  it('shows only published facts, each with its review [spec: catalog/visibility]', () => {
    const { snapshot, bank, river, shore, bankInventory } = bankWorld()
    const view = project(snapshot)
    expect(view?.id).toBe(bank.id)
    expect(view?.meanings[0]?.forms).toEqual({ plural: [{ form: 'banks', irregular: false }] })
    expect(view?.variants).toEqual([])
    expect(view?.pronunciations).toEqual([
      { ipa: 'bæŋk', accent: 'us', review: expect.objectContaining({ verdict: 'uncertain' }) },
    ])
    expect(senses(view)).toHaveLength(1)
    const only = firstSense(view)
    expect(only).toMatchObject({ id: river.id, gloss: 'land beside a river', labels: [], region: null, rare: false })
    expect(only?.review.gloss).toEqual(review(bankInventory))
    expect(only?.examples.map((example) => example.text)).toEqual(['We sat on the bank.'])
    expect(only?.translations).toEqual({ zh: ['河岸'] })
    expect(only?.relations.synonyms).toEqual([
      expect.objectContaining({ lemma: 'shore', sense_id: shore.sense.id, gloss: 'land along water' }),
    ])
    expect(view?.review).toEqual({ inventory: review(bankInventory), syllables: null, phrases: null, cefr: null })
  })

  it('hides an entry that is not live or has no published inventory', () => {
    const { snapshot, bank } = bankWorld()
    expect(project({ ...snapshot, entry: { ...bank, live: false } })).toBeNull()
    expect(
      project({
        ...snapshot,
        facts: snapshot.facts.filter((one) => one.kind !== 'senses' || one.status !== 'published'),
      }),
    ).toBeNull()
  })

  it('groups senses into meanings in inventory order, extras marked rare [spec: catalog/sense-order]', () => {
    const bank = entry('bank')
    const rely = inventorySense('To rely on.', 'verb')
    const money = inventorySense('An institution that keeps money.')
    const neat = inventorySense('Of a bank.', 'adjective')
    const oars = inventorySense('A row of oars.', 'noun', { rank: 'extra' })
    const published = inventory(bank, [rely, money, neat, oars])
    const view = project(snapshotOf(bank, [published]))
    expect(view?.meanings.map((meaning) => [meaning.pos, meaning.senses.map((one) => [one.id, one.rare])])).toEqual([
      ['verb', [[rely.id, false]]],
      [
        'noun',
        [
          [money.id, false],
          [oars.id, true],
        ],
      ],
      ['adjective', [[neat.id, false]]],
    ])
    expect(view ? publicFactIds(view).has(published.id) : false).toBe(true)
  })

  it('shows the published inventory while a correction of it is pending', () => {
    const bank = entry('bank')
    const old = inventorySense('Old gloss.')
    const published = inventory(bank, [old])
    const correction = { ...inventory(bank, [inventorySense('New gloss.')], 'pending'), supersedesId: published.id }
    expect(senses(project(snapshotOf(bank, [published, correction]))).map((one) => one.gloss)).toEqual(['Old gloss.'])
  })

  it('shows published grammar, word formation, and collocations with their translations [spec: catalog/usage-facts]', () => {
    const { snapshot, bank, river } = bankWorld()
    const morphology = fact('morphology', bank.id, { parts: [{ form: 'bank', role: 'base' }] })
    const grammar = fact('grammar', river.id, { countability: 'countable' })
    const collocation = fact('collocation', river.id, { text: 'river bank', pattern: 'noun_noun' })
    const usage: EntrySnapshot = {
      ...snapshot,
      facts: [
        ...snapshot.facts,
        morphology,
        grammar,
        fact('grammar', river.id, { countability: 'both' }, 'pending'),
        collocation,
        fact('translation', collocation.id, { language: 'zh', of: 'collocation', text: '河岸' }),
        fact('collocation', river.id, { text: 'steep bank', pattern: 'adjective_noun' }, 'rejected'),
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
      { text: 'river bank', pattern: 'noun_noun', translations: { zh: '河岸' }, review: review(collocation) },
    ])
    const ids = view ? publicFactIds(view) : new Set()
    expect([morphology.id, grammar.id, collocation.id].every((factId) => ids.has(factId))).toBe(true)
    const bare = project(snapshot)
    expect([bare?.morphology, firstSense(bare)?.grammar, firstSense(bare)?.collocations]).toEqual([null, null, []])
    const shortened = { type: 'abbreviation' as const, of: 'mistress' }
    const mrs = fact('morphology', bank.id, { parts: [{ form: 'Mrs', role: 'base' }], shortened })
    expect(project({ ...snapshot, facts: [...snapshot.facts, mrs] })?.morphology).toEqual({
      parts: [{ form: 'Mrs', role: 'base' }],
      shortened,
      review: review(mrs),
    })
    const patterned = fact('grammar', river.id, { patterns: ['ing_form'], prepositions: ['on'] })
    expect(firstSense(project({ ...snapshot, facts: [...snapshot.facts, patterned] }))?.grammar).toMatchObject({
      patterns: ['ing_form'],
      prepositions: ['on'],
    })
  })

  it('splits pronunciations, forms, variants, and labels the way a learner reads them [spec: catalog/meaning-shape] [spec: facts/write-labels]', () => {
    const bank = entry('bank')
    const river = inventorySense('Land beside a river.')
    const tilt = inventorySense('To tilt an aircraft.', 'verb', { register: 'technical' })
    const neat = inventorySense('Neat.', 'adjective', { register: 'informal', region: 'british' })
    const facts = [
      inventory(bank, [river, tilt, neat]),
      fact('pronunciation', bank.id, { ipa: 'bæŋk', accent: 'us' }),
      fact('pronunciation', bank.id, { ipa: 'bæŋk', accent: 'uk', strength: 'weak' }),
      fact('pronunciation', bank.id, { ipa: 'bɛŋk', accent: 'us', pos: 'verb' }),
      fact('pronunciation', bank.id, { ipa: 'bɑŋk', accent: 'us', pos: 'adverb' }),
      fact('form', bank.id, { form: 'banks', type: 'plural' }),
      fact('form', bank.id, { form: 'banked', type: 'past' }),
      fact('form', bank.id, { form: 'bankt', type: 'past', pos: 'verb' }),
      fact('form', bank.id, { form: 'banker', type: 'comparative' }),
      fact('form', bank.id, { form: 'banka', type: 'plural', pos: 'pronoun' }),
      fact('form', bank.id, { form: 'bankest', type: 'superlative', pos: 'adverb' }),
      fact('form', bank.id, { form: 'banque', type: 'variant' }),
      fact('form', bank.id, { form: 'bancque', type: 'variant', pos: 'noun' }),
    ]
    const view = project(snapshotOf(bank, facts))
    expect(view?.pronunciations.map(({ ipa, accent, strength }) => ({ ipa, accent, strength }))).toEqual([
      { ipa: 'bæŋk', accent: 'us', strength: undefined },
      { ipa: 'bæŋk', accent: 'uk', strength: 'weak' },
    ])
    const [noun, verb, adjective] = view?.meanings ?? []
    expect(noun?.pronunciations).toEqual([])
    expect(verb?.pronunciations).toEqual([{ ipa: 'bɛŋk', accent: 'us', review: expect.anything() }])
    expect([noun?.forms, verb?.forms, adjective?.forms]).toEqual([
      { plural: [{ form: 'banks', irregular: false }] },
      {
        past: [
          { form: 'banked', irregular: false },
          { form: 'bankt', irregular: true },
        ],
      },
      { comparative: [{ form: 'banker', irregular: false }] },
    ])
    expect(verb?.review.forms.past).toHaveLength(2)
    expect(view?.variants.map(({ form, pos }) => ({ form, pos }))).toEqual([
      { form: 'banque', pos: undefined },
      { form: 'bancque', pos: 'noun' },
    ])
    expect(senses(view).map((one) => [one.labels, one.region])).toEqual([
      [[], null],
      [['technical'], null],
      [['informal'], 'british'],
    ])
    // A form or pronunciation with no meaning to show it is not shown, nor public, but its form is indexed.
    expect(view?.forms.filter((one) => ['banka', 'bankest'].includes(one.form))).toEqual([
      { form: 'banka', type: 'plural', pos: 'pronoun' },
      { form: 'bankest', type: 'superlative', pos: 'adverb' },
    ])
    const hidden = facts.filter((one) =>
      ['bɑŋk', 'banka', 'bankest'].includes(
        (one.payload as { ipa?: string; form?: string }).ipa ?? (one.payload as { form?: string }).form ?? '',
      ),
    )
    const ids = view ? publicFactIds(view) : new Set()
    expect(hidden.map((one) => ids.has(one.id))).toEqual([false, false, false])
  })

  it('groups relations by what they say about each end [spec: catalog/relation-groups]', () => {
    const bank = entry('bank')
    const river = inventorySense('Land beside a river.')
    const others = {
      shore: neighbor('shore', 'Land along water.'),
      sea: neighbor('sea', 'Open water.'),
      land: neighbor('land', 'Ground.'),
      edge: neighbor('edge', 'A border.'),
      stream: neighbor('river', 'Flowing water.'),
      mud: neighbor('mud', 'Wet earth.'),
      dune: neighbor('dune', 'A hill of sand.'),
    }
    const relation = (type: FactPayloads['relation']['type'], from: SenseId, to: SenseId, domain?: 'biology') =>
      fact('relation', from, { type, target_sense_id: to, ...(domain ? { domain } : {}) })
    const outgoing = [
      relation('synonym', river.id, others.shore.sense.id),
      relation('hypernym', river.id, others.land.sense.id, 'biology'),
      relation('part_of', river.id, others.stream.sense.id),
    ]
    const incoming = [
      relation('antonym', others.sea.sense.id, river.id),
      relation('hypernym', others.dune.sense.id, river.id),
      relation('part_of', others.edge.sense.id, river.id),
      relation('synonym', others.mud.sense.id, river.id),
    ]
    const view = project(
      snapshotOf(bank, [inventory(bank, [river]), ...outgoing], {
        incoming,
        neighbors: neighborsOf(...Object.values(others)),
      }),
    )
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
      {
        lemma: 'land',
        sense_id: others.land.sense.id,
        gloss: 'Ground.',
        domain: 'biology',
        review: review(outgoing[1] as Fact),
      },
    ])
  })

  it('hides a relation until its other end is listed by a live entry with a published inventory [spec: catalog/relation-visibility]', () => {
    const { snapshot, shore } = bankWorld()
    const synonyms = (neighbors: EntrySnapshot['neighbors']) =>
      firstSense(project({ ...snapshot, neighbors }))?.relations.synonyms
    expect(synonyms({ ...neighborsOf(shore), liveEntries: new Set() })).toEqual([])
    expect(synonyms({ ...neighborsOf(shore), lemmas: new Map() })).toEqual([])
    expect(synonyms(neighborsOf({ ...shore, inventory: { ...shore.inventory, status: 'pending' } }))).toEqual([])
    expect(synonyms(neighborsOf())).toEqual([])
  })

  it('shows a relation pointing at a sense from its other end', () => {
    const { bank, river, shore, snapshot, bankInventory } = bankWorld()
    const relation = snapshot.facts.find((one) => one.kind === 'relation') as Fact
    const bankAsNeighbor: Neighbor = { node: bank, sense: river, inventory: bankInventory }
    const fromShore = snapshotOf(shore.node, [shore.inventory], {
      incoming: [relation],
      neighbors: neighborsOf(bankAsNeighbor),
    })
    expect(firstSense(project(fromShore))?.relations.synonyms).toEqual([
      expect.objectContaining({ lemma: 'bank', sense_id: river.id }),
    ])
    expect(firstSense(project({ ...fromShore, neighbors: neighborsOf() }))?.relations.synonyms).toEqual([])
  })

  it('keeps every translation and names each topic, with the first translation in the summary [spec: catalog/language]', () => {
    const { snapshot, river } = bankWorld()
    const facts = [
      ...snapshot.facts,
      fact('translation', river.id, { language: 'zh', of: 'sense', text: '岸' }),
      fact('topic', river.id, { topic_id: 'kitchen' as TopicId }),
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
    expect(firstSense(view)?.translations).toEqual({ zh: ['河岸', '岸'] })
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
      cefr_source: 'reference',
      gloss: 'land beside a river',
      translations: { zh: '河岸' },
      image_url: null,
    })
    expect(() => project({ ...snapshot, facts }, { topicNames: new Map() })).toThrow('does not exist')
  })

  it('summarizes an inventory with no senses', () => {
    const bank = entry('bank')
    const view = project(snapshotOf(bank, [inventory(bank, [])]))
    expect(view?.meanings).toEqual([])
    expect(view?.summary).toEqual({
      lemma: 'bank',
      pos: [],
      cefr: null,
      cefr_source: null,
      gloss: null,
      translations: {},
      image_url: null,
    })
  })

  it('places a form under its labelled part of speech, else the first carrier of its type the entry has [spec: catalog/form-placement]', () => {
    const meanings = (...pos: Pos[]) => pos.map((one) => ({ pos: one }))
    expect(formMeaning('past', undefined, meanings('auxiliary', 'noun'))?.pos).toBe('auxiliary')
    expect(formMeaning('past', undefined, meanings('auxiliary', 'noun', 'verb'))?.pos).toBe('verb')
    expect(formMeaning('past', 'auxiliary', meanings('auxiliary', 'noun', 'verb'))?.pos).toBe('auxiliary')
    expect(formMeaning('plural', undefined, meanings('pronoun', 'noun'))?.pos).toBe('noun')
    expect(formMeaning('plural', undefined, meanings('determiner', 'pronoun'))?.pos).toBe('pronoun')
    expect(formMeaning('plural', undefined, meanings('determiner', 'adverb'))?.pos).toBe('determiner')
    expect(formMeaning('comparative', undefined, meanings('determiner', 'adverb'))?.pos).toBe('adverb')
    expect(formMeaning('superlative', undefined, meanings('noun', 'determiner'))?.pos).toBe('determiner')
    expect(formMeaning('third_person_singular', undefined, meanings('noun'))).toBeUndefined()
    expect(formMeaning('past', 'verb', meanings('noun'))).toBeUndefined()
    expect(formMeaning('variant', undefined, meanings('noun'))).toBeUndefined()
  })

  it('projects syllables, a form pronunciation, example translations, and the phrases list [spec: catalog/new-fields]', () => {
    const go = entry('go')
    const move = inventorySense('To move.', 'verb')
    const home = sentence('We go home.')
    const example = fact('example', move.id, { sentence_id: home })
    const syllables = fact('syllables', go.id, { syllables: ['go'] })
    const [goOn, goOut, unknown] = [id<EntryId>(), id<EntryId>(), id<EntryId>()]
    const proverb = sentence('Easy come, easy go.')
    const phrases = fact('phrases', go.id, {
      phrases: [
        { type: 'phrasal_verb', entry_id: goOn },
        { type: 'idiom', entry_id: goOut, sense_id: move.id },
        { type: 'idiom', entry_id: unknown },
        { type: 'saying', sentence_id: proverb },
      ],
    })
    const facts = [
      inventory(go, [move]),
      fact('form', go.id, { form: 'went', type: 'past', ipa: 'went', accent: 'uk' }),
      syllables,
      phrases,
      example,
      fact('translation', home, { language: 'zh', of: 'sentence', text: '我们回家。' }),
      fact('sentence_meaning', proverb, { gloss: 'What is gained easily is lost easily.' }),
      fact('translation', proverb, { language: 'zh', of: 'sentence', text: '来得容易去得快。' }),
    ]
    const phraseEntries = new Map([
      [goOn, 'go on'],
      [goOut, 'go out'],
    ])
    const view = project(snapshotOf(go, facts, { phraseEntries }))
    expect(view?.meanings[0]?.forms).toEqual({ past: [{ form: 'went', irregular: true, ipa: 'went', accent: 'uk' }] })
    expect(view?.syllables).toEqual(['go'])
    expect(view?.phrases).toEqual([
      { type: 'phrasal_verb', lemma: 'go on', sense_id: null },
      { type: 'idiom', lemma: 'go out', sense_id: move.id },
    ])
    expect(view?.sayings).toEqual([
      {
        sentence_id: proverb,
        text: 'Easy come, easy go.',
        meaning: 'What is gained easily is lost easily.',
        translations: { zh: '来得容易去得快。' },
      },
    ])
    expect(view?.phrase_type).toBeNull()
    expect(view?.review.syllables).toEqual(review(syllables))
    expect(view?.review.phrases).toEqual(review(phrases))
    expect(view?.meanings[0]?.senses[0]?.examples[0]).toMatchObject({
      sentence_id: home,
      text: 'We go home.',
      translations: { zh: '我们回家。' },
    })
    // A phrase entry carries its type.
    const goOnEntry = { ...entry('go on'), id: goOn }
    const typed = project(
      snapshotOf(goOnEntry, [inventory(goOnEntry, [inventorySense('To continue.', 'verb')])], {
        phraseType: 'phrasal_verb',
      }),
    )
    expect(typed?.phrase_type).toBe('phrasal_verb')
  })

  it('shows each part of speech as active or passive for both tiers, with their skills [spec: catalog/productive-use-read]', () => {
    const run = entry('run')
    const move = inventorySense('To move fast on foot.', 'verb')
    const manage = inventorySense('To manage.', 'verb', { register: 'informal' })
    const act = inventorySense('An act of running.', 'noun', { register: 'informal' })
    const melted = inventorySense('Melted.', 'adjective', { rank: 'extra', register: 'dated' })
    const verb = fact('productive_use', run.id, { pos: 'verb', native: true, learner: false })
    const facts = [
      inventory(run, [move, manage, act, melted]),
      verb,
      // Only published facts show, and one about a part of speech the entry lacks shows nowhere.
      fact('productive_use', run.id, { pos: 'noun', native: true, learner: true }, 'pending'),
      fact('productive_use', run.id, { pos: 'adverb', native: true, learner: true }),
    ]
    const view = project(snapshotOf(run, facts))
    expect(
      view?.meanings.map(({ pos, productive_use, skills, review }) => ({
        pos,
        productive_use,
        skills,
        review: review.productive_use,
      })),
    ).toEqual([
      {
        pos: 'verb',
        productive_use: { native: true, learner: false },
        skills: { native: ['listen', 'speak', 'read', 'write'], learner: ['listen', 'read'] },
        review: review(verb),
      },
      { pos: 'noun', productive_use: null, skills: null, review: null },
      {
        pos: 'adjective',
        productive_use: { native: false, learner: false },
        skills: { native: ['listen', 'read'], learner: ['listen', 'read'] },
        review: null,
      },
    ])
  })

  it('fails loudly on an example whose sentence is gone', () => {
    const go = entry('go')
    const move = inventorySense('To move.', 'verb')
    const facts = [inventory(go, [move]), fact('example', move.id, { sentence_id: id<SentenceId>() })]
    expect(() => project(snapshotOf(go, facts))).toThrow('does not exist')
  })

  it('indexes every published form for lookup, shown or not [spec: catalog/form-index]', () => {
    const will = entry('will')
    const modal = inventorySense('Expressing the future.', 'auxiliary')
    const testament = inventorySense('A legal document.')
    const facts = [
      inventory(will, [modal, testament]),
      fact('form', will.id, { form: 'would', type: 'past' }),
      fact('form', will.id, { form: 'wills', type: 'plural' }),
      fact('form', will.id, { form: 'willed', type: 'past', pos: 'verb' }),
      fact('form', will.id, { form: 'willing', type: 'present_participle', pos: 'verb' }, 'pending'),
      fact('form', will.id, { form: 'wil', type: 'variant' }),
      fact('form', will.id, { form: 'willer', type: 'comparative' }),
    ]
    const view = project(snapshotOf(will, facts))
    expect(view?.meanings.map(({ pos, forms }) => ({ pos, forms }))).toEqual([
      { pos: 'auxiliary', forms: { past: [{ form: 'would', irregular: true }] } },
      { pos: 'noun', forms: { plural: [{ form: 'wills', irregular: false }] } },
    ])
    expect(view?.forms).toEqual([
      { form: 'would', type: 'past', pos: 'auxiliary' },
      { form: 'wills', type: 'plural', pos: 'noun' },
      { form: 'willed', type: 'past', pos: 'verb' },
      { form: 'wil', type: 'variant', pos: null },
      { form: 'willer', type: 'comparative', pos: null },
    ])
  })

  it('refuses the review of unreviewed facts', () => {
    const { bank } = bankWorld()
    expect(() => reviewOf(fact('form', bank.id, { form: 'x', type: 'plural' }, 'pending'))).toThrow('not a reviewed')
    expect(() => reviewOf({ ...fact('form', bank.id, { form: 'x', type: 'plural' }), review: null })).toThrow(
      'not a reviewed',
    )
  })
})

describe('management view', () => {
  it('shows every fact once, with relations pointing at the entry, and the entry scores', () => {
    const { snapshot, river } = bankWorld()
    const incoming = fact('relation', id<SenseId>(), { type: 'antonym', target_sense_id: river.id })
    const repeated = snapshot.facts[0] as Fact
    const view = managedEntryView({ ...snapshot, incoming: [incoming, repeated] })
    expect(view.entry).toBe(snapshot.entry)
    expect(view.batch).toBe(1)
    expect(view.senses).toBe(snapshot.senses)
    expect(view.facts.map((one) => one.id)).toEqual([...snapshot.facts, incoming].map((one) => one.id))
    expect(view.completeness).toBeGreaterThan(0)
    expect(view.completeness).toBeLessThan(1)
    expect(view.credibility).toBeGreaterThan(0)
    expect(view.slots.total).toBeGreaterThan(0)
  })

  it('shows each example with its sentence text and each phrases item with its lemma or text [spec: catalog/view-texts]', () => {
    const { snapshot, example } = bankWorld()
    const said = sentence('Look before you leap.')
    const phrase = id<EntryId>()
    const unknown = id<EntryId>()
    const list = fact('phrases', snapshot.entry.id, {
      phrases: [
        { type: 'compound', entry_id: phrase },
        { type: 'idiom', entry_id: unknown },
        { type: 'saying', sentence_id: said },
      ],
    })
    const view = managedEntryView({
      ...snapshot,
      facts: [...snapshot.facts, list],
      phraseEntries: new Map([[phrase, 'bank account']]),
      phraseType: null,
    })
    expect(view.phraseType).toBeNull()
    expect(view.facts.find((one) => one.id === example.id)?.payload).toEqual({
      sentence_id: example.payload.sentence_id,
      text: 'We sat on the bank.',
    })
    expect(view.facts.find((one) => one.id === list.id)?.payload).toEqual({
      phrases: [
        { type: 'compound', entry_id: phrase, text: 'bank account' },
        { type: 'idiom', entry_id: unknown },
        { type: 'saying', sentence_id: said, text: 'Look before you leap.' },
      ],
    })
    const missing = fact('example', id<SenseId>(), { sentence_id: id<SentenceId>() })
    expect(managedEntryView({ ...snapshot, facts: [missing] }).facts[0]?.payload).toEqual(missing.payload)
  })
})
