import type { ReferenceSource } from '@shared/reference'
import { HttpResponse, http } from 'msw'

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
    morphology: {
      parts: [
        { form: 'anim', role: 'root', meaning: 'breath' },
        { form: '-al', role: 'suffix' },
      ],
      family: [
        { lemma: 'animalistic', pos: ['adjective'], cefr: null, gloss: 'Like an animal.' },
        { lemma: 'animalism', pos: [], cefr: null, gloss: null },
      ],
    },
    meanings: [
      {
        pos: 'noun',
        cefr: 'A1',
        pronunciations: [],
        forms: { plural: [{ form: 'animals', irregular: false }] },
        senses: [
          sense(senseIds.animal, 'A living creature that is not a plant or a human.', {
            translations: ['动物'],
            examples: [{ text: 'Please do not feed the animals.', translation: '请不要给动物喂食。' }],
            collocations: [{ text: 'wild animal', pattern: 'adjective_noun' }],
            topics: [{ id: 'wild-animals', name: { en: 'Wild animals', zh: '野生动物' } }],
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
            grammar: { countability: 'countable', patterns: ['to_infinitive'], prepositions: ['about'] },
          }),
          sense(senseIds.rare, 'An old sense nobody uses.', { rare: true }),
        ],
      },
      {
        pos: 'adjective',
        cefr: 'B1',
        pronunciations: [],
        forms: {},
        senses: [
          sense(crypto.randomUUID(), 'Relating to animals.', {
            grammar: { position: 'attributive_only', patterns: [], prepositions: [] },
          }),
        ],
      },
    ],
    phrases: [{ lemma: 'animal kingdom', pos: ['noun'], cefr: null, gloss: 'All animals.' }],
  }
}

export const searchHit = (lemma: string, gloss: string, match = 'lemma') => ({
  lemma,
  pos: ['noun'],
  cefr: 'A1',
  gloss,
  translation: '动物',
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
        return HttpResponse.json({ ...animalEntry(), lemma: 'bird', morphology: null, pronunciations: [], phrases: [] })
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
    morphology: {
      parts: [{ form: 'going', role: 'base', lemma: 'going' }],
      shortened: { type: 'clipping', of: 'going' },
      family: [],
    },
    meanings: [
      {
        pos: 'verb',
        cefr: null,
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
            examples: [{ text: 'We went home.' }],
            collocations: [
              { text: 'go home', pattern: 'verb_noun' },
              { text: 'go away', pattern: 'verb_adverb' },
            ],
            topics: [{ id: 'travel', name: { en: 'Travel', zh: '旅行' } }],
            relations: { synonyms: [], antonyms: [], broader: [], narrower: [], part_of: [], parts: [] },
          },
        ],
      },
    ],
    phrases: [],
  }
}
