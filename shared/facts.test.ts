import { describe, expect, it } from 'vitest'
import { factPayloadSchemas, submitFactInputSchema } from './facts'

const sense = '00000000-0000-4000-8000-000000000001'
const entry = '00000000-0000-4000-8000-000000000002'

const issues = (input: unknown) => {
  const result = submitFactInputSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}
const gloss = (text: string, extra = {}) =>
  issues({ kind: 'sense', subject_id: sense, payload: { gloss: text, ...extra } })
const ipa = (text: string, extra = {}) =>
  issues({ kind: 'pronunciation', subject_id: entry, payload: { ipa: text, accent: 'us', ...extra } })

describe('gloss format', () => {
  it.each([
    'To move quickly on foot.',
    'Used to indicate position above and touching a surface.',
    '(of food) No longer fresh.',
    "Used after a verb, usually followed by 'for'.",
    "An objection, especially in the phrase 'no ifs or buts'.",
    '24 hours.',
  ])('accepts %j [spec: facts/gloss-format]', (text) => {
    expect(gloss(text)).toEqual([])
  })

  it.each([
    ['on top of a surface', ['starts with a capital letter', 'ends with a period']],
    ['Supported by a surface.  ', []],
    ['Ok.', ['at least 6 characters']],
    [`${'A very long gloss. '.repeat(20)}`, ['at most 300 characters']],
    ["Only; merely, as in 'but a child'.", ['has no examples']],
    ['A small animal, e.g. a mouse.', ['has no examples']],
    ['A small animal, for example a mouse.', ['has no examples']],
    ['Used to greet someone: "Hello there!".', ['has no examples']],
  ])('checks %j [spec: facts/gloss-format]', (text, expected) => {
    expect(gloss(text)).toEqual(expected.map((fragment) => expect.stringContaining(fragment)))
  })

  it('applies to sense creation too, and only to writes: stored glosses still parse [spec: facts/gloss-format]', () => {
    expect(factPayloadSchemas.sense.safeParse({ gloss: 'on top of a surface' }).success).toBe(true)
  })
})

describe('ipa format', () => {
  it.each([
    'ˈwɔtər',
    'tuː',
    'ˈæn.sɚ',
    'ˈɔrɡən ˌsɪstəm',
    'ðət',
    'bʌtn̩',
  ])('accepts %j [spec: facts/ipa-format]', (text) => {
    expect(ipa(text)).toEqual([])
  })

  it.each([
    ['tuː, tə', 'exactly one transcription'],
    ['/tuː/', 'exactly one transcription'],
    ['[tuː]', 'exactly one transcription'],
    ['tuː; tə', 'exactly one transcription'],
    ['ˈɪntər(ə)nəl', 'exactly one transcription'],
    ['dɹɪŋk', '"ɹ" (write r)'],
    ['gʊd', '"g" (write ɡ)'],
    ["'wɔtər", `"'" (write ˈ)`],
    ['tu:', '":" (write ː)'],
    ['Wɔtər', '"W"'],
  ])('rejects %j [spec: facts/ipa-format]', (text, fragment) => {
    const messages = ipa(text)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain(fragment)
  })

  it('applies only to writes: stored transcriptions still parse [spec: facts/ipa-format]', () => {
    expect(factPayloadSchemas.pronunciation.safeParse({ ipa: 'tuː, tə', accent: 'us' }).success).toBe(true)
  })
})

describe('labels', () => {
  it('accepts the optional register, form POS, and pronunciation strength and POS [spec: facts/write-labels]', () => {
    expect(gloss('Semen.', { register: 'taboo' })).toEqual([])
    expect(ipa('tə', { strength: 'weak', pos: 'preposition' })).toEqual([])
    expect(
      issues({ kind: 'form', subject_id: entry, payload: { form: 'would', type: 'past', pos: 'auxiliary' } }),
    ).toEqual([])
  })

  it('rejects labels outside their vocabularies [spec: facts/write-labels]', () => {
    expect(gloss('Semen.', { register: 'vulgar' })).toHaveLength(1)
    expect(ipa('tə', { strength: 'reduced' })).toHaveLength(1)
    expect(
      issues({ kind: 'form', subject_id: entry, payload: { form: 'would', type: 'past', pos: 'modal' } }),
    ).toHaveLength(1)
  })
})
