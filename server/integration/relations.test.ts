import type { SenseId } from '@shared/facts'
import { factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  admit,
  headword,
  issueAgentKey,
  reviewPending,
  type SenseSpec,
  senseIds,
  submit,
  submitInventory,
  submitOk,
} from './helpers'

const errorOf = (body: unknown) => apiErrorSchema.parse(body).error
const nouns = (...glosses: string[]): SenseSpec[] => glosses.map((gloss) => ({ pos: 'noun', gloss }))

async function producer() {
  const token = await issueAgentKey()
  const relate = (type: string, from: string, to: string) =>
    submit(token, 'relation', from, { type, target_sense_id: to })
  return { token, relate }
}

describe('relation write rules', () => {
  afterEach(() => vi.restoreAllMocks())

  it('refuses a second relation type to the same entry and a hypernym 2-cycle with 422 [spec: facts/relation-write-rules-api]', async () => {
    const { relate } = await producer()
    const [number] = (await headword('number', nouns('A quantity of people or things.'))).senses as [SenseId]
    const [quantity, measure] = (await headword('quantity', nouns('An amount of something.', 'A measurable property.')))
      .senses as [SenseId, SenseId]
    const synonym = await relate('synonym', quantity, number)
    expect(synonym.status).toBe(201)
    const { fact } = factWriteResultSchema.parse(synonym.body)

    const second = await relate('hypernym', number, measure)
    expect(second.status).toBe(422)
    expect(errorOf(second.body)).toMatchObject({
      code: 'invalid_reference',
      message: expect.stringContaining(`already has a live synonym relation (${fact.id})`),
    })

    const [shock] = (await headword('shock', nouns('An unexpected upsetting event.'))).senses as [SenseId]
    const [surprise] = (await headword('surprise', nouns('An unexpected event.'))).senses as [SenseId]
    expect((await relate('hypernym', shock, surprise)).status).toBe(201)
    const cycle = await relate('hypernym', surprise, shock)
    expect(cycle.status).toBe(422)
    expect(errorOf(cycle.body).message).toContain('cannot each be a kind of the other')
  })

  it('refuses a relation to a sense no published inventory of a live entry lists [spec: facts/relation-shown-ends-api]', async () => {
    const { token, relate } = await producer()
    const [big] = (await headword('big', [{ pos: 'adjective', gloss: 'Of more than average size.' }])).senses as [
      SenseId,
    ]
    const largeId = await admit('large')
    const pending = await submitInventory(token, largeId, [{ pos: 'adjective', gloss: 'Of great size or amount.' }])
    const [large] = senseIds(pending) as [SenseId]

    const refused = await relate('synonym', big, large)
    expect(refused.status).toBe(422)
    expect(errorOf(refused.body)).toMatchObject({
      code: 'invalid_reference',
      message: expect.stringContaining('blocked_on'),
    })
    await reviewPending()
    expect((await relate('synonym', big, large)).status).toBe(201)
  })

  it('refuses a synonym between spellings of one word over HTTP [spec: facts/relation-padding-api]', async () => {
    const { token, relate } = await producer()
    const practise = await headword('practise', [{ pos: 'verb', gloss: 'To do something repeatedly to improve.' }])
    const practice = await headword('practice', [{ pos: 'verb', gloss: 'To rehearse something regularly.' }])
    await submitOk(token, 'form', practise.entryId, { form: 'practice', type: 'variant' })
    const synonym = await relate('synonym', practise.senses[0] as string, practice.senses[0] as string)
    expect([synonym.status, errorOf(synonym.body).message]).toEqual([
      422,
      expect.stringContaining('are spellings of one word'),
    ])
  })

  it('refuses periphrastic comparisons, non-house IPA, ASCII zh punctuation, and links to dated senses [spec: facts/completeness-write-rules-api]', async () => {
    const { token, relate } = await producer()
    const careful = await headword('careful', [{ pos: 'adjective', gloss: 'Taking care to avoid danger.' }])
    const periphrastic = await submit(token, 'form', careful.entryId, { form: 'more careful', type: 'comparative' })
    expect([periphrastic.status, errorOf(periphrastic.body).message]).toEqual([
      422,
      expect.stringContaining('"more careful" is a periphrastic comparative form'),
    ])
    const dotted = await submit(token, 'pronunciation', careful.entryId, { ipa: 'ˈkɛr.fəl', accent: 'us' })
    expect(dotted.status).toBe(400)
    expect(JSON.stringify(dotted.body)).toContain('no syllable dots')
    expect(JSON.stringify(dotted.body)).toContain('An American ipa writes the vowel of')
    const ascii = await submit(token, 'translation', careful.senses[0] as string, {
      language: 'zh',
      of: 'sense',
      text: '小心的;仔细的',
    })
    expect(ascii.status).toBe(400)
    const wary = await headword('wary', [
      { pos: 'adjective', gloss: 'Cautious about possible dangers.', register: 'dated' },
    ])
    const old = wary.senses[0] as string
    const synonym = await relate('synonym', careful.senses[0] as string, old)
    expect([synonym.status, errorOf(synonym.body).message]).toEqual([
      422,
      `Sense ${old} is labelled dated; a relation links only current senses. Relate a current sense of the word instead.`,
    ])
  })
})
