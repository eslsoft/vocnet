import type { PublicEntry, PublicSense } from '@shared/catalog'
import type { EntryId, FactId, SenseId, TopicId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import type { EntrySnapshot } from './catalog-view'
import type { FactOf } from './fact'
import { contentKeyOf } from './fact-kinds'
import { formMatchOf, publicEntryDocument, publicSenseOf, publicViewRecord, readDocument } from './public-view'
import type { Lemma } from './term'

const at = '2026-01-01T00:00:00.000Z'
const meta = (id: string) => ({ id: id as FactId, confidence: 0.9, verdict: 'pass' as const })
const entryId = 'e0000000-0000-4000-8000-000000000001' as EntryId
const reference = { frequency: { zipf: 5.16, rank: 691, source_id: 'wordfreq' }, cefr: [] }

const sense = (id: string, topics: string[]): PublicSense => ({
  id: id as SenseId,
  pos: 'noun',
  gloss: `gloss of ${id}`,
  fact: meta(`f-${id}`),
  examples: [],
  translations: [],
  relations: [],
  topics: topics.map((topic) => ({ ...meta(`t-${id}-${topic}`), topic_id: topic as TopicId })),
  grammar: null,
  collocations: [],
  common: null,
})

const bank: PublicEntry = {
  id: entryId,
  lemma: 'bank',
  fact: meta('entry'),
  forms: [
    { ...meta('form-1'), form: 'banks', type: 'plural' },
    { ...meta('form-2'), form: 'Banks', type: 'variant' },
  ],
  pronunciations: [],
  morphology: null,
  sense_list: null,
  senses: [sense('s1', ['finance', 'places']), sense('s2', [])],
  ...reference,
}

function snapshot(status: 'published' | 'pending'): EntrySnapshot {
  const entryFact: FactOf<'entry'> = {
    id: 'entry' as FactId,
    kind: 'entry',
    subjectId: entryId,
    objectId: null,
    contentKey: 'entry',
    payload: {},
    status,
    supersedesId: null,
    author: 'agent:a',
    review:
      status === 'published'
        ? {
            reviewer: 'llm',
            model: 'm',
            verdict: 'pass',
            confidence: 0.9,
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
  return {
    entry: { id: entryId, lemma: 'bank' as Lemma, createdBy: 'agent:a', createdAt: at },
    seed: false,
    senses: [],
    facts: [entryFact],
    incoming: [],
    flagged: new Set(),
    neighbors: { senses: [], facts: [] },
  }
}

describe('public view [spec: public-view/document]', () => {
  it('is the public projection with the reference data, and nothing for an entry that is not public', () => {
    expect(publicEntryDocument(snapshot('published'), reference)).toEqual({
      id: entryId,
      lemma: 'bank',
      fact: meta('entry'),
      forms: [],
      pronunciations: [],
      morphology: null,
      sense_list: null,
      senses: [],
      ...reference,
    })
    expect(publicEntryDocument(snapshot('pending'), reference)).toBeNull()
  })

  it('derives the form rows under the form content key and one row per topic tag', () => {
    expect(publicViewRecord(bank)).toEqual({
      document: bank,
      forms: [
        { contentKey: contentKeyOf('form', { form: 'banks', type: 'plural' }), factId: 'form-1' },
        { contentKey: contentKeyOf('form', { form: 'Banks', type: 'variant' }), factId: 'form-2' },
      ],
      taggedSenses: [
        { topicId: 'finance', senseId: 's1', pos: 'noun', gloss: 'gloss of s1' },
        { topicId: 'places', senseId: 's1', pos: 'noun', gloss: 'gloss of s1' },
      ],
    })
  })

  it('cuts a sense and a form match out of the stored document as stored', () => {
    const stored = readDocument(JSON.stringify(bank))
    expect(publicSenseOf(stored, 's2' as SenseId)).toEqual({ ...bank.senses[1], entry: { id: entryId, lemma: 'bank' } })
    expect(publicSenseOf(stored, 'missing' as SenseId)).toBeNull()
    expect(formMatchOf(stored, 'form-2' as FactId)).toEqual({
      entry: { id: entryId, lemma: 'bank' },
      form: bank.forms[1],
    })
    expect(() => formMatchOf(stored, 'missing' as FactId)).toThrow('has no form missing')
  })
})
