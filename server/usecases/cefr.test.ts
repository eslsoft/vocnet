import { agentA, curatorAgent } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import { headword } from '@server/testing/seed'
import { describe, expect, it } from 'vitest'
import { getPublicEntry, listPublicEntries } from './catalog'
import { classifyWork } from './classify'
import { submitFact } from './facts'

const none = { lang: null, review: false }
const everyEntry = { prefix: '', levels: [], pos: null, topic: null }

async function asylumWorld() {
  const world = fakeWorld()
  const asylum = await headword(world, 'asylum', [
    { pos: 'noun', gloss: 'Protection a state gives a refugee.' },
    { pos: 'verb', gloss: 'To give someone asylum.', rank: 'extra' },
  ])
  return { world, asylum }
}

const read = async (world: ReturnType<typeof fakeWorld>, lemma: string, review = false) =>
  (await getPublicEntry(world.deps, lemma, { lang: null, review })).read()

describe('CEFR levels', () => {
  it('shows a level a curator imported, for every part of speech of a word the lists do not level [spec: catalog/cefr-level]', async () => {
    const { world, asylum } = await asylumWorld()
    expect(await read(world, 'asylum')).toMatchObject({ cefr: null, cefr_source: null })
    const { fact } = await submitFact(world.deps, curatorAgent, {
      kind: 'cefr',
      subject_id: asylum.entry.id,
      payload: { level: 'C1' },
      curation: { reason: 'The vocnet-v1 CEFR-C1 word list.' },
    })
    const entry = await read(world, 'asylum', true)
    expect(entry).toMatchObject({ cefr: 'C1', cefr_source: 'curated' })
    expect(entry.meanings.map((meaning) => [meaning.pos, meaning.cefr])).toEqual([
      ['noun', 'C1'],
      ['verb', 'C1'],
    ])
    expect(entry.review?.cefr?.fact_id).toBe(fact.id)
    const listed = await listPublicEntries(world.deps, { ...everyEntry, levels: ['C1'] }, 'lemma', { limit: 10 }, none)
    expect(listed.items.map((item) => [item.lemma, item.cefr, item.cefr_source])).toEqual([['asylum', 'C1', 'curated']])
  })

  it('marks the server estimate as estimated, and keeps a reference level over any fact [spec: catalog/cefr-level]', async () => {
    const { world, asylum } = await asylumWorld()
    world.answerDecision('jev', () => ({ model: 'jev-test', answers: {} }))
    world.chooseLlm((prompt) =>
      prompt.system.startsWith("You classify one word's CEFR level")
        ? { level: 'C2', confidence: 0.6, reason: 'Formal.' }
        : { native: true, learner: true, confidence: 0.8, reason: 'Common.' },
    )
    await classifyWork(world.deps, 'trace-cron', 60_000)
    expect(await read(world, 'asylum')).toMatchObject({ cefr: 'C2', cefr_source: 'estimated' })

    // A word the reference lists level shows that level; a level fact on it never shows.
    world.references.set('bank', { frequency: null, cefr: [{ pos: 'noun', level: 'A2', source_id: 'cefrj-1.6' }] })
    const bank = await headword(world, 'bank', [{ pos: 'noun', gloss: 'An organization that keeps money.' }])
    await submitFact(world.deps, agentA, { kind: 'cefr', subject_id: bank.entry.id, payload: { level: 'C2' } })
    expect(await read(world, 'bank', true)).toMatchObject({
      cefr: 'A2',
      cefr_source: 'reference',
      review: { cefr: null },
    })
    expect(asylum.entry.lemma).toBe('asylum')
  })
})
