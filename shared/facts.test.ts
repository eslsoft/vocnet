import { describe, expect, it } from 'vitest'
import { factPayloadSchemas, isCompleteSentence, submitFactInputSchema } from './facts'

const sense = '00000000-0000-4000-8000-000000000001'
const entry = '00000000-0000-4000-8000-000000000002'
const sentence = '00000000-0000-4000-8000-000000000003'

const issues = (input: unknown) => {
  const result = submitFactInputSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}
const gloss = (text: string, extra = {}) =>
  issues({
    kind: 'senses',
    subject_id: entry,
    payload: { senses: [{ pos: 'noun', gloss: text, rank: 'common', ...extra }] },
  })
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

  it('applies only to writes: stored inventories still parse [spec: facts/gloss-format]', () => {
    expect(
      factPayloadSchemas.senses.safeParse({
        senses: [{ id: sense, pos: 'noun', gloss: 'on top of a surface', rank: 'common' }],
      }).success,
    ).toBe(true)
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
    issues({ kind: 'translation', subject_id: sense, payload: { language, of: 'sense', text: '河岸' } })

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

  it('writes zh with fullwidth punctuation and each alternative of an equivalent once [spec: facts/zh-translation-format]', () => {
    const zh = (text: string, of = 'sense') =>
      issues({ kind: 'translation', subject_id: sense, payload: { language: 'zh', of, text } })
    expect(zh('银行；河岸')).toEqual([])
    expect(zh('建造；建造')).toEqual(['A translation lists each alternative once: "建造；建造" repeats one.'])
    expect(zh('建造； 建造')).toEqual(['A translation lists each alternative once: "建造；建造" repeats one.'])
    for (const text of ['银行;河岸', '银行,河岸', '银行(机构)']) {
      expect(zh(text)).toEqual(['A zh text uses fullwidth punctuation: write ； ， （ ） in place of ASCII ; , ( ).'])
    }
    expect(zh('我们回家，好吗？', 'sentence')).toEqual([])
    expect(zh('我们回家,好吗？', 'sentence')).toEqual([expect.stringContaining('fullwidth punctuation')])
    // A sentence may repeat a phrase between semicolons; only an equivalent lists alternatives.
    expect(zh('走吧；走吧', 'sentence')).toEqual([])
  })

  it('names what it translates and keeps a sense equivalent short [spec: facts/translation-of]', () => {
    const translation = (payload: object) => issues({ kind: 'translation', subject_id: sense, payload })
    expect(translation({ language: 'zh', text: '河岸' })).toHaveLength(1)
    expect(translation({ language: 'zh', of: 'gloss', text: '河岸' })).toHaveLength(1)
    expect(translation({ language: 'zh', of: 'collocation', text: '大雨' })).toEqual([])
    expect(translation({ language: 'zh', of: 'sense', text: '河'.repeat(201) })).toEqual([
      'A sense equivalent is at most 200 characters.',
    ])
    expect(translation({ language: 'zh', of: 'sentence', text: '河'.repeat(201) })).toEqual([])
    // An example is translated as its sentence.
    expect(translation({ language: 'zh', of: 'example', text: '河岸' })).toHaveLength(1)
  })

  it('applies only to writes: stored translations still parse [spec: facts/zh-translation-format]', () => {
    expect(factPayloadSchemas.translation.safeParse({ language: 'zh', of: 'sense', text: '银行;河岸' }).success).toBe(
      true,
    )
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
    expect(gloss('A large goods vehicle.', { region: 'welsh' })).toHaveLength(1)
    expect(gloss('An afternoon.', { region: 'australian', register: 'informal' })).toEqual([])
    expect(gloss('Not good at all.', { register: 'ironic' })).toEqual([])
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
      'Parts are in written order: prefixes, then the bases, then suffixes.',
    ])
    expect(morphology(['re-', 'prefix'], ['-ly', 'suffix'])).toEqual(['A word formation has at least one base part.'])
  })

  it('refuses a Latin or Greek root, since a word not built on a present-day word is simple [spec: facts/morphology-synchronic]', () => {
    const root =
      '"port" is a root; a part is a present-day English word (base), a prefix, or a suffix. A word not built on a present-day English word is a simple word: one base part, the word itself ("important", "factory").'
    expect(morphology(['im-', 'prefix'], ['port', 'root'], ['-ant', 'suffix'])).toEqual([
      root,
      'A word formation has at least one base part.',
    ])
    expect(morphology(['important', 'base'])).toEqual([])
    expect(morphology(['tele-', 'prefix'], ['phone', 'base'])).toEqual([])
    for (const form of ['a.m.', "o'clock", 'Mrs.', 'e.g.']) expect(morphology([form, 'base'])).toEqual([])
    expect(morphology(['.am', 'base'])).toEqual([expect.stringContaining('is not a base')])
  })

  it('gives a shortened word one base part and its source [spec: facts/morphology-shortened]', () => {
    const shortened = (parts: unknown[], source: unknown) => submit('morphology', entry, { parts, shortened: source })
    const mrs = { form: 'Mrs', role: 'base' }
    expect(shortened([mrs], { type: 'abbreviation', of: 'mistress' })).toEqual([])
    expect(shortened([mrs], { type: 'acronym', of: 'mistress' })).toHaveLength(1)
    expect(shortened([mrs], { type: 'abbreviation' })).toHaveLength(1)
    expect(shortened([{ ...mrs, lemma: 'mistress' }], { type: 'abbreviation', of: 'mistress' })).toEqual([
      'A shortened word is one base part, the word itself, without a lemma; "mistress" goes in shortened.of only.',
    ])
    expect(
      shortened(
        [
          { form: 'brunch', role: 'base' },
          { form: '-es', role: 'suffix' },
        ],
        { type: 'blend', of: 'breakfast and lunch' },
      ),
    ).toEqual([
      'A shortened word is one base part, the word itself, without a lemma; "breakfast and lunch" goes in shortened.of only.',
    ])
  })

  it('needs a collocation of at least two words [spec: facts/usage-formats]', () => {
    expect(submit('collocation', sense, { text: 'heavy rain', pattern: 'adjective_noun' })).toEqual([])
    expect(submit('collocation', sense, { text: 'rain', pattern: 'adjective_noun' })).toEqual([
      'A collocation has at least two words.',
    ])
    expect(submit('collocation', sense, { text: 'heavy rain', pattern: 'adjective' })).toHaveLength(1)
  })
})

describe('sense inventory format', () => {
  const submit = (senses: unknown[]) => issues({ kind: 'senses', subject_id: entry, payload: { senses } })
  const common = { pos: 'noun', gloss: 'A written work.', rank: 'common' }
  const extra = { pos: 'noun', gloss: "A bookmaker's record of bets.", rank: 'extra' }

  it('lists at least one common sense, the common ones first, and each existing sense once [spec: facts/inventory-format]', () => {
    expect(submit([common, extra])).toEqual([])
    expect(
      submit([
        { ...common, id: sense },
        { ...extra, id: entry },
      ]),
    ).toEqual([])
    expect(submit([extra])).toEqual(['An inventory has at least one common sense.'])
    expect(submit([common, extra, common])).toEqual(['The common senses come first, then the extra ones.'])
    expect(
      submit([
        { ...common, id: sense },
        { ...extra, id: sense },
      ]),
    ).toEqual(['An inventory names each existing sense once.'])
    expect(submit([])).toContain('An inventory has at least one common sense.')
    expect(submit([{ ...common, rank: 'main' }])).not.toEqual([])
  })

  it('stores every sense by id [spec: facts/inventory-format]', () => {
    expect(factPayloadSchemas.senses.safeParse({ senses: [common] }).success).toBe(false)
    expect(factPayloadSchemas.senses.safeParse({ senses: [{ ...common, id: sense }] }).success).toBe(true)
  })
})

describe('phrases format', () => {
  const submit = (phrases: unknown[]) => issues({ kind: 'phrases', subject_id: entry, payload: { phrases } })

  it('lists typed phrases by id or text, each once [spec: facts/phrases-format]', () => {
    expect(
      submit([
        { type: 'phrasal_verb', text: 'give up' },
        { type: 'idiom', entry_id: entry, sense_id: sense },
        { type: 'saying', text: 'Give and take.' },
        { type: 'saying', sentence_id: sentence },
      ]),
    ).toEqual([])
    expect(submit([{ type: 'idiom', text: 'give' }])).toHaveLength(1)
    expect(submit([{ type: 'saying', text: 'give and take' }])).toHaveLength(1)
    expect(submit([{ type: 'saying', text: 'Give and take.', sense_id: sense }])).toHaveLength(1)
    expect(submit([{ type: 'idiom', text: 'give up', entry_id: entry }])).toHaveLength(1)
    expect(submit([{ type: 'proverb', text: 'Give and take.' }])).toHaveLength(1)
    expect(submit(['give up'])).toHaveLength(1)
    expect(
      submit([
        { type: 'idiom', text: 'give up' },
        { type: 'phrasal_verb', text: 'Give up' },
      ]),
    ).toEqual(['A phrase list names each phrase once.'])
    expect(submit([])).toHaveLength(1)
    expect(isCompleteSentence('Look before you leap.')).toBe(true)
    expect(isCompleteSentence('"Look before you leap."')).toBe(true)
    expect(isCompleteSentence('look before you leap')).toBe(false)
    expect(isCompleteSentence('Look')).toBe(false)
  })

  it('stores each item by id, a view adding its text [spec: facts/phrases-format]', () => {
    expect(
      factPayloadSchemas.phrases.safeParse({ phrases: [{ type: 'idiom', entry_id: entry, text: 'give up' }] }).success,
    ).toBe(true)
    expect(factPayloadSchemas.phrases.safeParse({ phrases: ['give up'] }).success).toBe(false)
  })

  it('takes a sentence meaning as a dictionary-style gloss [spec: facts/sentence-meaning]', () => {
    const meaning = (gloss: string) => issues({ kind: 'sentence_meaning', subject_id: sentence, payload: { gloss } })
    expect(meaning('Each side should give something.')).toEqual([])
    expect(meaning('give')).not.toEqual([])
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

  it('takes an example as its sentence, by id or text alone: translations are their own facts [spec: facts/translation-of]', () => {
    const example = (payload: object) => issues({ kind: 'example', subject_id: sense, payload })
    expect(example({ text: 'We go home.' })).toEqual([])
    expect(example({ sentence_id: sentence })).toEqual([])
    expect(example({ sentence_id: sentence, text: 'We go home.' })).toHaveLength(1)
    expect(example({ text: 'We go home.', translations: { zh: '我们回家。' } })).toHaveLength(1)
  })

  it('takes syllables without spaces [spec: facts/syllables]', () => {
    const syllables = (parts: string[]) =>
      issues({ kind: 'syllables', subject_id: entry, payload: { syllables: parts } })
    expect(syllables(['a', 'bil', 'i', 'ty'])).toEqual([])
    expect(syllables(['post of', 'fice'])).toEqual([expect.stringContaining('A syllable has no spaces')])
    expect(syllables([])).not.toEqual([])
  })
})
