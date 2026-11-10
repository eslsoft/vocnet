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
    'ˈænsər',
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
    ['ˈæn.sɚ', '"." (write nothing: no syllable dots), "ɚ" (write ər in American, ə in British)'],
    ['bɝd', '"ɝ" (write ɜːr in American, ɜː in British)'],
    ['bɛd', 'An American ipa writes the vowel of "bed" as e, not ɛ'],
  ])('rejects %j [spec: facts/ipa-format]', (text, fragment) => {
    const messages = ipa(text)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain(fragment)
  })

  it('keeps ɛ for a British transcription only, in pronunciations and forms alike [spec: facts/ipa-format]', () => {
    expect(ipa('ˈsɛntə', { accent: 'uk' })).toEqual([])
    const form = (accent: string) =>
      issues({ kind: 'form', subject_id: entry, payload: { form: 'fed', type: 'past', ipa: 'fɛd', accent } })
    expect(form('uk')).toEqual([])
    expect(form('us')).toEqual([expect.stringContaining('An American ipa writes the vowel of "bed" as e')])
  })

  it('applies only to writes: stored transcriptions still parse [spec: facts/ipa-format]', () => {
    expect(factPayloadSchemas.pronunciation.safeParse({ ipa: 'tuː, tə', accent: 'us' }).success).toBe(true)
  })
})

describe('translation language', () => {
  const translation = (language: string) =>
    issues({ kind: 'translation', subject_id: sense, payload: { language, text: '河岸' } })

  it('accepts a served language [spec: facts/translation-language]', () => {
    expect(translation('zh')).toEqual([])
  })

  it.each([
    'zh-Hans',
    'zh-Hant',
    'zh-CN',
    'fr',
  ])('rejects %j and names the served languages [spec: facts/translation-language]', (language) => {
    expect(translation(language)).toEqual([expect.stringContaining('served language: zh')])
  })

  it('writes zh with fullwidth punctuation and each alternative once [spec: facts/zh-translation-format]', () => {
    const zh = (text: string) => issues({ kind: 'translation', subject_id: sense, payload: { language: 'zh', text } })
    expect(zh('银行；河岸')).toEqual([])
    expect(zh('建造；建造')).toEqual(['A translation lists each alternative once: "建造；建造" repeats one.'])
    expect(zh('建造； 建造')).toEqual(['A translation lists each alternative once: "建造；建造" repeats one.'])
    for (const text of ['银行;河岸', '银行,河岸', '银行(机构)']) {
      expect(zh(text)).toEqual(['A zh text uses fullwidth punctuation: write ； ， （ ） in place of ASCII ; , ( ).'])
    }
    const example = (translation: string) =>
      issues({
        kind: 'example',
        subject_id: sense,
        payload: { text: 'We go home.', translations: { zh: translation } },
      })
    expect(example('我们回家，好吗？')).toEqual([])
    expect(example('我们回家,好吗？')).toEqual([expect.stringContaining('fullwidth punctuation')])
  })

  it('applies only to writes: stored translations still parse [spec: facts/translation-language]', () => {
    expect(factPayloadSchemas.translation.safeParse({ language: 'zh-Hans', text: '河岸' }).success).toBe(true)
  })
})

describe('labels', () => {
  it('accepts the optional register, region, form POS, and pronunciation strength and POS [spec: facts/write-labels]', () => {
    expect(gloss('Semen.', { register: 'taboo' })).toEqual([])
    expect(gloss('A large goods vehicle.', { region: 'british' })).toEqual([])
    expect(ipa('tə', { strength: 'weak', pos: 'preposition' })).toEqual([])
    expect(
      issues({ kind: 'form', subject_id: entry, payload: { form: 'would', type: 'past', pos: 'auxiliary' } }),
    ).toEqual([])
  })

  it('rejects labels outside their vocabularies [spec: facts/write-labels]', () => {
    expect(gloss('Semen.', { register: 'vulgar' })).toHaveLength(1)
    expect(gloss('A large goods vehicle.', { region: 'australian' })).toHaveLength(1)
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
    expect(
      submit('grammar', sense, { countability: 'uncountable', article: 'with_the', number: 'singular_only' }),
    ).toEqual([])
    expect(submit('grammar', sense, { countability: 'countable', number: 'dual' })).toHaveLength(1)
    expect(submit('grammar', sense, { position: 'both' })).toEqual([])
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
    for (const form of ['a.m.', "o'clock", 'Mrs.', 'e.g.']) expect(morphology([form, 'base'])).toEqual([])
    expect(morphology(['.am', 'base'])).toEqual([expect.stringContaining('is not a base')])
  })

  it('needs a collocation of at least two words [spec: facts/usage-formats]', () => {
    expect(submit('collocation', sense, { text: 'heavy rain', pattern: 'adjective_noun' })).toEqual([])
    expect(submit('collocation', sense, { text: 'rain', pattern: 'adjective_noun' })).toEqual([
      'A collocation has at least two words.',
    ])
    expect(submit('collocation', sense, { text: 'heavy rain', pattern: 'adjective' })).toHaveLength(1)
  })
})

describe('gap closure format', () => {
  const closure = (payload: unknown) => issues({ kind: 'gap_closure', subject_id: sense, payload })

  it('names a closable gap and a reason [spec: facts/gap-closure-format]', () => {
    expect(closure({ gap: 'collocations', reason: 'A month name has no common collocations.' })).toEqual([])
    expect(closure({ gap: 'examples', reason: 'None.' })).toHaveLength(1)
    expect(closure({ gap: 'collocations', reason: ' ' })).toHaveLength(1)
    expect(closure({ gap: 'collocations' })).toHaveLength(1)
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

describe('new data field formats', () => {
  it('takes a form pronunciation only with its accent, in the IPA format [spec: facts/form-pronunciation]', () => {
    const form = (payload: object) =>
      issues({ kind: 'form', subject_id: entry, payload: { form: 'went', type: 'past', ...payload } })
    expect(form({ ipa: 'went', accent: 'us' })).toEqual([])
    expect(form({})).toEqual([])
    expect(form({ ipa: 'went' })).toEqual(['A form gives ipa and accent together.'])
    expect(form({ accent: 'uk' })).toEqual(['A form gives ipa and accent together.'])
    expect(form({ ipa: '/went/', accent: 'us' })).toEqual([expect.stringContaining('without slashes')])
  })

  it('takes example translations in served languages only [spec: facts/example-translation]', () => {
    const example = (translations: object) =>
      issues({ kind: 'example', subject_id: sense, payload: { text: 'We go home.', translations } })
    expect(example({ zh: '我们回家。' })).toEqual([])
    expect(example({ fr: 'Nous rentrons.' })).toEqual([expect.stringContaining('served language')])
  })

  it('takes syllables without spaces [spec: facts/syllables]', () => {
    const syllables = (parts: string[]) =>
      issues({ kind: 'syllables', subject_id: entry, payload: { syllables: parts } })
    expect(syllables(['a', 'bil', 'i', 'ty'])).toEqual([])
    expect(syllables(['post of', 'fice'])).toEqual([expect.stringContaining('A syllable has no spaces')])
    expect(syllables([])).not.toEqual([])
  })
})
