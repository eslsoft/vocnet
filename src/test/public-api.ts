import type { ReferenceSource } from '@shared/reference'
import { HttpResponse, http } from 'msw'

const noPhrases = { by_sense: [], phrasal_verbs: [], idioms: [], compounds: [], sayings: [] }

// The public dictionary API (/v1) at the network edge, for the public site's component tests.

export const sources: ReferenceSource[] = [
  {
    id: 'wordfreq-3.1.1',
    name: 'wordfreq',
    version: '3.1.1',
    license: 'CC BY-SA 4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    changes: 'Kept the English list.',
    attribution: 'Word frequencies from wordfreq by Robyn Speer.',
    url: 'https://github.com/rspeer/wordfreq',
    retrieved_at: '2026-11-09',
  },
]

export function apiError(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status })
}

export const sourcesHandler = (items: ReferenceSource[] | null = sources) =>
  http.get('/v1/sources', () =>
    items ? HttpResponse.json({ items }) : apiError(429, 'rate_limited', 'Sources are unavailable.'),
  )

type Related = { lemma: string; sense_id: string; gloss: string; domain?: 'biology' | 'medicine' }
const related = (lemma: string, gloss: string, domain?: Related['domain']): Related => ({
  lemma,
  sense_id: crypto.randomUUID(),
  gloss,
  ...(domain ? { domain } : {}),
})
const noRelations = { synonyms: [], antonyms: [], broader: [], narrower: [], part_of: [], parts: [] }

export const senseIds = { animal: crypto.randomUUID(), brute: crypto.randomUUID(), rare: crypto.randomUUID() }

/** "animal" as GET /v1/entries/animal?lang=zh serves it, trimmed to what the page shows. */
export function animalEntry(domain?: 'biology' | 'medicine') {
  const sense = (id: string, gloss: string, extra: Record<string, unknown> = {}) => ({
    id,
    gloss,
    labels: [],
    region: null,
    rare: false,
    grammar: { countability: 'countable', patterns: [], prepositions: [] },
    examples: [],
    collocations: [],
    topics: [],
    image: null,
    relations: noRelations,
    ...extra,
  })
  return {
    lang: 'zh',
    id: crypto.randomUUID(),
    lemma: 'animal',
    frequency: { zipf: 4.81, rank: 1611 },
    pronunciations: [
      { ipa: 'ˈænɪməl', accent: 'us' },
      { ipa: 'ˈænɪml', accent: 'uk' },
    ],
    variants: [],
    syllables: ['an', 'i', 'mal'],
    cefr: 'A1',
    cefr_source: 'reference',
    image: null,
    morphology: {
      parts: [
        { form: 'anim', role: 'root', meaning: 'breath' },
        { form: '-al', role: 'suffix' },
      ],
      family: [
        {
          lemma: 'animalistic',
          pos: ['adjective'],
          cefr: null,
          cefr_source: null,
          gloss: 'Like an animal.',
          image_url: null,
        },
        { lemma: 'animalism', pos: [], cefr: null, cefr_source: null, gloss: null, image_url: null },
      ],
    },
    meanings: [
      {
        pos: 'noun',
        cefr: 'A1',
        productive_use: { native: true, learner: true },
        skills: { native: ['listen', 'speak', 'read', 'write'], learner: ['listen', 'speak', 'read', 'write'] },
        pronunciations: [],
        forms: { plural: [{ form: 'animals', irregular: false }] },
        senses: [
          sense(senseIds.animal, 'A living creature that is not a plant or a human.', {
            translations: ['动物'],
            examples: [
              {
                sentence_id: '00000000-0000-4000-8000-0000000000e1' as never,
                text: 'Please do not feed the animals.',
                translation: '请不要给动物喂食。',
              },
            ],
            collocations: [{ text: 'wild animal', pattern: 'adjective_noun' }],
            topics: [
              {
                id: 'wild-animals',
                name: { en: 'Wild animals', zh: '野生动物' },
                category: { id: 'nature', name: { en: 'Nature', zh: '自然' } },
              },
            ],
            relations: {
              ...noRelations,
              antonyms: [related('human', 'A person.')],
              broader: [
                related('creature', 'A living being.'),
                ...(domain ? [related('organism', 'A living thing.', domain)] : []),
              ],
              narrower: [
                related('bird', 'An animal with feathers.'),
                related('cat', 'A small pet.'),
                related('cat', 'A wild cat.'),
                ...Array.from({ length: 12 }, (_, index) => related(`kind${index}`, 'A kind.')),
              ],
            },
          }),
          sense(senseIds.brute, 'A cruel person.', {
            labels: ['informal'],
            relations: { ...noRelations, narrower: [related('beast', 'A cruel person.')] },
            grammar: { countability: 'countable', patterns: ['to_infinitive'], prepositions: ['about'] },
          }),
          sense(senseIds.rare, 'An old sense nobody uses.', { rare: true }),
        ],
      },
      {
        pos: 'adjective',
        cefr: 'B1',
        productive_use: { native: true, learner: false },
        skills: { native: ['listen', 'speak'], learner: ['listen'] },
        pronunciations: [],
        forms: {},
        senses: [
          sense(crypto.randomUUID(), 'Relating to animals.', {
            grammar: { position: 'attributive_only', patterns: [], prepositions: [] },
          }),
        ],
      },
    ],
    phrase_type: null,
    phrases: {
      by_sense: [
        {
          sense_id: senseIds.animal as never,
          phrases: [
            {
              lemma: 'animal kingdom',
              pos: ['noun'],
              cefr: null,
              cefr_source: null,
              gloss: 'All animals.',
              image_url: null,
            },
          ],
        },
      ],
      phrasal_verbs: [],
      idioms: [
        {
          lemma: 'party animal',
          pos: ['noun'],
          cefr: null,
          cefr_source: null,
          gloss: 'Someone who loves parties.',
          image_url: null,
        },
      ],
      compounds: [],
      sayings: [
        {
          sentence_id: '00000000-0000-4000-8000-0000000000e3' as never,
          text: 'Man is a social animal.',
          meaning: 'People need the company of others.',
          translation: '人是社会性动物。',
        },
        {
          sentence_id: '00000000-0000-4000-8000-0000000000e4' as never,
          text: 'Every animal has its day.',
          meaning: null,
        },
      ],
    },
  }
}

export const searchHit = (lemma: string, gloss: string, match = 'lemma') => ({
  lemma,
  pos: ['noun'],
  cefr: 'A1',
  cefr_source: 'reference',
  gloss,
  translation: '动物',
  image_url: null,
  match,
})

/** Serves animal and bird; any other lemma is 404, as an exact lookup is. Records each read's URL. */
export function dictionaryApi({ search = [] as ReturnType<typeof searchHit>[] } = {}) {
  const reads: URL[] = []
  const handlers = [
    http.get('/v1/entries/:lemma', ({ request, params }) => {
      const url = new URL(request.url)
      reads.push(url)
      const domain = url.searchParams.get('domain') as 'biology' | null
      if (params.lemma === 'animal') return HttpResponse.json(animalEntry(domain ?? undefined))
      if (params.lemma === 'bird') {
        return HttpResponse.json({
          ...animalEntry(),
          lemma: 'bird',
          morphology: null,
          pronunciations: [],
          phrases: noPhrases,
        })
      }
      return apiError(404, 'not_found', `No entry for "${params.lemma}".`)
    }),
    http.get('/v1/search', ({ request }) => {
      const url = new URL(request.url)
      reads.push(url)
      const q = url.searchParams.get('q') ?? ''
      const items = search.filter((hit) => hit.lemma.startsWith(q) || hit.gloss.includes(q))
      return HttpResponse.json({ lang: 'zh', items, next_cursor: null })
    }),
  ]
  return { handlers, reads }
}

/** "go": irregular forms, a weak form, a variant, a regional sense, a shortening, and no reference data. */
export function goEntry() {
  return {
    lang: 'zh',
    id: crypto.randomUUID(),
    lemma: 'go',
    frequency: null,
    pronunciations: [
      { ipa: 'ɡoʊ', accent: 'us' },
      { ipa: 'ɡəʊ', accent: 'uk' },
    ],
    variants: [{ form: 'goe' }],
    syllables: ['go'],
    cefr: null,
    cefr_source: null,
    image: null,
    morphology: {
      parts: [{ form: 'going', role: 'base', lemma: 'going' }],
      shortened: { type: 'clipping', of: 'going' },
      family: [],
    },
    meanings: [
      {
        pos: 'verb',
        cefr: null,
        productive_use: null,
        skills: null,
        pronunciations: [
          { ipa: 'ɡəʊ', accent: 'uk', strength: 'strong' },
          { ipa: 'ɡə', accent: 'uk', strength: 'weak' },
        ],
        forms: {
          past: [{ form: 'went', irregular: true }],
          past_participle: [
            { form: 'gone', irregular: true },
            { form: 'been', irregular: true },
          ],
        },
        senses: [
          {
            id: crypto.randomUUID(),
            gloss: 'To move or travel.',
            labels: [],
            region: 'south_african',
            rare: false,
            grammar: null,
            examples: [{ sentence_id: '00000000-0000-4000-8000-0000000000e2' as never, text: 'We went home.' }],
            collocations: [
              { text: 'go home', pattern: 'verb_noun' },
              { text: 'go away', pattern: 'verb_adverb' },
            ],
            topics: [
              {
                id: 'travel',
                name: { en: 'Travel', zh: '旅行' },
                category: { id: 'leisure', name: { en: 'Leisure', zh: '休闲' } },
              },
            ],
            image: null,
            relations: { synonyms: [], antonyms: [], broader: [], narrower: [], part_of: [], parts: [] },
          },
        ],
      },
    ],
    phrase_type: null,
    phrases: noPhrases,
  }
}

/** Stable sense ids of the category tree's words. */
export const memberIds: Record<string, string> = Object.fromEntries(
  ['bird', 'fish', 'eagle', 'lion', 'tiger'].map((lemma) => [lemma, crypto.randomUUID()]),
)

const memberOf = (lemma: string, depth: number) => ({
  lemma,
  sense_id: memberIds[lemma],
  pos: 'noun',
  cefr: lemma === 'eagle' ? null : 'A1',
  cefr_source: lemma === 'eagle' ? null : 'reference',
  gloss: `A ${lemma}.`,
  translation: lemma === 'bird' ? '鸟' : undefined,
  image_url: null,
  depth,
  parents: [],
})

/** A category tree: animal has bird and fish; bird has eagle; eagle has none. Records each read. */
export function networkApi({ topicsFail = false } = {}) {
  const reads: URL[] = []
  const tree: Record<string, ReturnType<typeof memberOf>[]> = {
    [senseIds.animal]: [memberOf('bird', 1), memberOf('fish', 1), memberOf('eagle', 2)],
    [memberIds.bird]: [memberOf('eagle', 1)],
    [memberIds.eagle]: [],
    [senseIds.brute]: [],
  }
  const handlers = [
    http.get('/v1/entries/colour', () => HttpResponse.json(goEntry())),
    ...dictionaryApi().handlers,
    http.get('/v1/senses/:id/members', ({ request, params }) => {
      const url = new URL(request.url)
      reads.push(url)
      if (params.id === memberIds.fish) {
        return HttpResponse.json(
          url.searchParams.get('cursor')
            ? { lang: 'zh', total: 2, items: [memberOf('tiger', 1)], next_cursor: null }
            : { lang: 'zh', total: 2, items: [memberOf('lion', 1)], next_cursor: 'page-2' },
        )
      }
      const items = tree[String(params.id)]
      if (!items) return apiError(404, 'not_found', 'Sense not found.')
      return HttpResponse.json({ lang: 'zh', total: items.length, items, next_cursor: null })
    }),
    http.get('/v1/topics', () =>
      topicsFail
        ? apiError(429, 'rate_limited', 'Too many requests.')
        : HttpResponse.json({
            categories: [
              {
                id: 'nature',
                name: { en: 'Nature', zh: '自然' },
                image_url: null,
                sense_count: 2,
                entry_count: 2,
                topics: [
                  {
                    id: 'wild-animals',
                    name: { en: 'Wild animals', zh: '野生动物' },
                    image_url: null,
                    sense_count: 2,
                    entry_count: 2,
                  },
                ],
              },
            ],
          }),
    ),
    http.get('/v1/topics/:id/senses', ({ request, params }) => {
      const url = new URL(request.url)
      reads.push(url)
      if (params.id === 'nature') return HttpResponse.json({ lang: 'zh', items: [], next_cursor: null })
      const cursor = url.searchParams.get('cursor')
      const item = (lemma: string) => ({ ...memberOf(lemma, 1), depth: undefined, parents: undefined, rare: false })
      return HttpResponse.json(
        cursor
          ? { lang: 'zh', items: [item('tiger')], next_cursor: null }
          : { lang: 'zh', items: [item('lion')], next_cursor: 'page-2' },
      )
    }),
  ]
  return { handlers, reads }
}
