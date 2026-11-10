import type { EntryId, FactId, FactKind, FactPayloads, FactStatus, SenseId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { type EntrySnapshot, factMeta, projectPublicEntry, projectPublicSense, publicFactIds } from './catalog-view'
import type { Fact, FactOf } from './fact'
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
const sense = (of: EntryNode): SenseWithLemma => ({
  id: id<SenseId>(),
  entryId: of.id,
  pos: 'noun',
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
    const meta = { confidence: 0.6, verdict: 'uncertain' }
    const view = projectPublicEntry(usage)
    expect(view?.morphology).toEqual({ id: morphology.id, ...meta, parts: [{ form: 'bank', role: 'base' }] })
    expect(view?.senses[0]?.grammar).toEqual({ id: grammar.id, ...meta, countability: 'countable' })
    expect(view?.senses[0]?.collocations).toEqual([
      { id: collocation.id, ...meta, text: 'river bank', pattern: 'noun_noun' },
    ])
    const ids = view ? publicFactIds(view) : new Set()
    expect([morphology.id, grammar.id, collocation.id].every((factId) => ids.has(factId))).toBe(true)
    const bare = projectPublicEntry(snapshot)
    expect([bare?.morphology, bare?.senses[0]?.grammar, bare?.senses[0]?.collocations]).toEqual([null, null, []])
  })

  it('orders senses by the published sense list, common first, and marks each [spec: catalog/sense-order]', () => {
    const { snapshot, bank, bankSense } = bankWorld()
    const [money, oars, added] = [sense(bank), sense(bank), sense(bank)]
    const glossed = [
      fact('sense', money.id, { gloss: 'An institution that keeps money.' }),
      fact('sense', oars.id, { gloss: 'A row of oars.' }),
      fact('sense', added.id, { gloss: 'A slope of land.' }),
    ]
    const published = fact('sense_list', bank.id, { common: [money.id, bankSense.id], extra: [oars.id] })
    const pending = fact('sense_list', bank.id, { common: [bankSense.id], extra: [] }, 'pending')
    const listed: EntrySnapshot = {
      ...snapshot,
      senses: [bankSense, added, oars, money],
      facts: [...snapshot.facts, ...glossed, published, pending],
    }
    const view = projectPublicEntry(listed)
    expect(view?.senses.map((one) => [one.id, one.common])).toEqual([
      [money.id, true],
      [bankSense.id, true],
      [oars.id, false],
      [added.id, null],
    ])
    expect(view?.sense_list).toEqual({ id: published.id, confidence: 0.6, verdict: 'uncertain' })
    expect(view ? publicFactIds(view).has(published.id) : false).toBe(true)
    const unlisted = projectPublicEntry({ ...listed, facts: [...snapshot.facts, ...glossed, pending] })
    expect(unlisted?.sense_list).toBeNull()
    expect(unlisted?.senses.map((one) => [one.id, one.common])).toEqual([
      [bankSense.id, null],
      [added.id, null],
      [oars.id, null],
      [money.id, null],
    ])
  })

  it('shows only published facts, each with its id, confidence, and verdict [spec: catalog/visibility]', () => {
    const { snapshot, bankSense, shoreSense } = bankWorld()
    const view = projectPublicEntry(snapshot)
    expect(view?.forms.map((form) => form.form)).toEqual(['banks'])
    expect(view?.pronunciations).toEqual([
      expect.objectContaining({ ipa: 'bæŋk', confidence: 0.6, verdict: 'uncertain' }),
    ])
    expect(view?.senses).toHaveLength(1)
    const [only] = view?.senses ?? []
    expect(only).toMatchObject({ id: bankSense.id, gloss: 'land beside a river', fact: { verdict: 'uncertain' } })
    expect(only?.examples.map((example) => example.text)).toEqual(['We sat on the bank.'])
    expect(only?.translations).toEqual([expect.objectContaining({ language: 'fr', text: 'rive' })])
    expect(only?.relations).toEqual([
      expect.objectContaining({
        type: 'synonym',
        direction: 'outgoing',
        sense: { id: shoreSense.id, lemma: 'shore', pos: 'noun', gloss: 'land along water' },
      }),
    ])
  })

  it('shows the register, form POS, and pronunciation strength and POS a fact carries [spec: facts/write-labels]', () => {
    const { snapshot, bank, bankSense } = bankWorld()
    const labelled: EntrySnapshot = {
      ...snapshot,
      facts: [
        fact('entry', bank.id, {}),
        fact('sense', bankSense.id, { gloss: 'To rely on.', register: 'informal' }),
        fact('form', bank.id, { form: 'banked', type: 'past', pos: 'verb' }),
        fact('pronunciation', bank.id, { ipa: 'bæŋk', accent: 'us', strength: 'strong', pos: 'verb' }),
      ],
    }
    const view = projectPublicEntry(labelled)
    expect(view?.senses[0]).toMatchObject({ gloss: 'To rely on.', register: 'informal' })
    expect(view?.forms).toEqual([expect.objectContaining({ form: 'banked', type: 'past', pos: 'verb' })])
    expect(view?.pronunciations).toEqual([expect.objectContaining({ ipa: 'bæŋk', strength: 'strong', pos: 'verb' })])
  })

  it('hides an entry whose entry fact is not published', () => {
    const { snapshot } = bankWorld()
    const hidden = {
      ...snapshot,
      facts: snapshot.facts.map((f) => (f.kind === 'entry' ? { ...f, status: 'pending' as const } : f)),
    }
    expect(projectPublicEntry(hidden)).toBeNull()
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
    expect(projectPublicEntry(unpublish('entry'))?.senses[0]?.relations).toEqual([])
    expect(projectPublicEntry(unpublish('sense'))?.senses[0]?.relations).toEqual([])
    const unknownTarget = { ...snapshot, neighbors: { senses: [], facts: [] } }
    expect(projectPublicEntry(unknownTarget)?.senses[0]?.relations).toEqual([])
  })

  it('shows relations pointing at a sense as incoming', () => {
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
    expect(projectPublicEntry(fromShore)?.senses[0]?.relations).toEqual([
      expect.objectContaining({ direction: 'incoming', sense: expect.objectContaining({ lemma: 'bank' }) }),
    ])
    const hiddenSource = { ...fromShore, neighbors: { senses: [bankSense], facts: [] } }
    expect(projectPublicEntry(hiddenSource)?.senses[0]?.relations).toEqual([])
  })

  it('projects one sense with its entry, or nothing when hidden', () => {
    const { snapshot, bankSense, bank } = bankWorld()
    expect(projectPublicSense(snapshot, bankSense.id)).toMatchObject({
      id: bankSense.id,
      entry: { id: bank.id, lemma: 'bank' },
    })
    expect(projectPublicSense(snapshot, id<SenseId>())).toBeNull()
  })

  it('refuses the meta of unreviewed facts', () => {
    const { bank } = bankWorld()
    expect(() => factMeta(fact('form', bank.id, { form: 'x', type: 'plural' }, 'pending'))).toThrow('not a reviewed')
  })
})
