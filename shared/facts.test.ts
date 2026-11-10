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

describe('grammar, word formation, and collocation formats', () => {
  const submit = (kind: string, subject: string, payload: unknown) => issues({ kind, subject_id: subject, payload })
  const morphology = (...parts: Array<[string, string]>) =>
    submit('morphology', entry, { parts: parts.map(([form, role]) => ({ form, role })) })

  it('requires a grammar property and each pattern once [spec: facts/usage-formats]', () => {
    expect(submit('grammar', sense, { transitivity: 'both', patterns: ['ing_form'] })).toEqual([])
    expect(submit('grammar', sense, {})).toEqual(['A grammar fact names at least one property.'])
    expect(submit('grammar', sense, { patterns: ['ing_form', 'ing_form'] })).toEqual([
      'Each grammar pattern is listed once.',
    ])
    expect(submit('grammar', sense, { patterns: ['gerund'] })).toHaveLength(1)
    expect(submit('grammar', sense, { transitivity: 'intransitive', prepositions: ['on', 'upon'] })).toEqual([])
    expect(submit('grammar', sense, { transitivity: 'intransitive', prepositions: ['on', 'on'] })).toEqual([
      'Each grammar preposition is listed once.',
    ])
    expect(submit('grammar', sense, { prepositions: [] })).toHaveLength(1)
    expect(submit('grammar', sense, { prepositions: ['about', 'at', 'for', 'of', 'on'] })).toHaveLength(1)
    expect(submit('grammar', sense, { prepositions: ['during'] })).toHaveLength(1)
    expect(submit('grammar', sense, { patterns: ['preposition'] })).toHaveLength(1)
  })

  it('spells parts with their hyphens in written order [spec: facts/usage-formats]', () => {
    expect(morphology(['un-', 'prefix'], ['happy', 'base'], ['-ness', 'suffix'])).toEqual([])
    expect(morphology(['well', 'base'], ['being', 'base'])).toEqual([])
    expect(morphology(['un', 'prefix'], ['happy', 'base'], ['ness', 'suffix'])).toEqual([
      '"un" is not a prefix: a prefix is letters ending in a hyphen ("un-").',
      '"ness" is not a suffix: a suffix is a hyphen followed by letters ("-ness").',
    ])
    expect(morphology(['happy', 'base'], ['un-', 'prefix'])).toEqual([
      'Parts are in written order: prefixes, then the bases or roots, then suffixes.',
    ])
    expect(morphology(['re-', 'prefix'], ['-ly', 'suffix'])).toEqual([
      'A word formation has at least one base or root part.',
    ])
    expect(morphology(['spect', 'root'])).toEqual(['A word of one part is a simple word: its part is a base.'])
  })

  it('needs a collocation of at least two words [spec: facts/usage-formats]', () => {
    expect(submit('collocation', sense, { text: 'heavy rain', pattern: 'adjective_noun' })).toEqual([])
    expect(submit('collocation', sense, { text: 'rain', pattern: 'adjective_noun' })).toEqual([
      'A collocation has at least two words.',
    ])
    expect(submit('collocation', sense, { text: 'heavy rain', pattern: 'adjective' })).toHaveLength(1)
  })
})

describe('sense list format', () => {
  const submit = (payload: unknown) => issues({ kind: 'sense_list', subject_id: entry, payload })

  it('names at least one common sense and each sense once [spec: facts/sense-list-write]', () => {
    expect(submit({ common: [sense], extra: [] })).toEqual([])
    expect(submit({ common: [], extra: [sense] })).toHaveLength(1)
    expect(submit({ common: [sense], extra: [sense] })).toEqual([
      'A sense list names each sense once, in common or in extra.',
    ])
    expect(submit({ common: [sense, sense], extra: [] })).toEqual([
      'A sense list names each sense once, in common or in extra.',
    ])
  })
})
