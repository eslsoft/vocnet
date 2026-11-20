import type { ReadVariant } from '@server/domain/public-view'
import type { Lemma } from '@server/domain/term'
import { admin, agentA, curatorAgent } from '@server/testing/actors'
import { type FakeWorld, fakeWorld } from '@server/testing/fakes'
import { publicEntryOf } from '@server/testing/public-view'
import { drainReviews, headword, type SeedSense } from '@server/testing/seed'
import type { EntryId, FactId, SenseId, SentenceId, TopicId } from '@shared/facts'
import type { WorkType } from '@shared/work'
import { describe, expect, it } from 'vitest'
import {
  createEntry,
  type EntryListFilter,
  getManagedEntry,
  getPublicEntry,
  getPublicSense,
  getPublicSentence,
  importCoreEntries,
  listEntryOverviews,
  listEntrySummaries,
  listPublicEntries,
  listSenseMembers,
  locateNode,
  lookupForm,
  retireEntry,
  searchPublicEntries,
} from './catalog'
import { submitFact } from './facts'

const reviewAll = drainReviews

/** One sense of a new headword: its id. */
async function senseOf(world: FakeWorld, lemma: string, seed: SeedSense): Promise<SenseId> {
  const { senses } = await headword(world, lemma, [seed])
  return senses[0] as SenseId
}

describe('createEntry', () => {
  it('admits a normalized lemma as a live headword of the batch, once, for curators only [spec: catalog/create-entry]', async () => {
    const world = fakeWorld()
    await expect(createEntry(world.deps, agentA, { lemma: 'ice cream', batch: 2 })).rejects.toMatchObject({
      code: 'forbidden',
    })
    const first = await createEntry(world.deps, admin, { lemma: '  ice   cream ', batch: 2 })
    expect(first).toMatchObject({ created: true, entry: { lemma: 'ice cream', createdBy: 'admin:admin-1' } })
    expect(await world.deps.nodes.admission(first.entry.id)).toEqual({ live: true, batch: 2 })
    expect(world.queued).toEqual([])

    const again = await createEntry(world.deps, curatorAgent, { lemma: 'ice cream', batch: 5 })
    expect(again).toMatchObject({ created: false, entry: { id: first.entry.id } })
    expect(await world.deps.nodes.admission(first.entry.id)).toEqual({ live: true, batch: 2 })
    expect(world.entries).toHaveLength(1)
    // Admitting rescores the entry: a headword without an inventory needs one.
    expect(world.items.map((item) => item.type)).toContain('senses')
  })

  it('reopens the slots passes were blocked on the admitted word [spec: work/blocked-reopen]', async () => {
    const world = fakeWorld()
    const cat = await headword(world, 'cat', [{ pos: 'noun', gloss: 'a small furry animal kept as a pet' }])
    const subjectId = cat.senses[0] as string
    const type: WorkType = 'synonyms'
    world.passes.push({
      entryId: cat.entry.id,
      type,
      subjectId,
      note: 'kitty is no entry',
      holder: 'agent:agent-a' as never,
      at: '2026-01-01T00:00:00.000Z',
    })
    world.blocks.push({ lemma: 'kitty', type, subjectId })
    await drainReviews(world)
    const synonymsOpen = () => world.items.some((item) => item.type === type && item.subjectId === subjectId)

    await createEntry(world.deps, admin, { lemma: 'puss', batch: 1 })
    expect(world.passes).toHaveLength(1)
    await createEntry(world.deps, admin, { lemma: 'kitty', batch: 1 })
    expect(world.passes).toEqual([])
    expect(world.blocks).toEqual([])
    expect(synonymsOpen()).toBe(true)
  })

  it('fails loudly when admitting stores no entry', async () => {
    const world = fakeWorld()
    const deps = { ...world.deps, nodes: { ...world.deps.nodes, admit: async () => [] } }
    await expect(createEntry(deps, admin, { lemma: 'bank', batch: 1 })).rejects.toThrow('stored no entry')
  })

  it('admits the CEFR headwords without an entry as batch 1, lowest level first, skipping single letters but "a" and "I" [spec: catalog/import-core]', async () => {
    const world = fakeWorld()
    const level = (level: 'A1' | 'B1') => ({
      frequency: null,
      cefr: [{ pos: 'noun' as const, level, source_id: 'cefrj' }],
    })
    for (const lemma of ['bank', 'a', 'I', 'x', 'cove']) world.references.set(lemma, level('A1'))
    world.references.set('according to', level('B1'))
    world.references.set('tide', { frequency: { zipf: 4, rank: 1, source_id: 'wordfreq' }, cefr: [] })
    await createEntry(world.deps, admin, { lemma: 'cove', batch: 3 })
    await expect(importCoreEntries(world.deps, agentA, 3)).rejects.toMatchObject({ code: 'forbidden' })

    const skipped = { letters: ['x'], contractions: [], characters: [], inflections: [], variants: [] }
    expect(await importCoreEntries(world.deps, curatorAgent, 3)).toEqual({
      created: ['I', 'a', 'bank'],
      skipped,
      remaining: 1,
    })
    expect(await importCoreEntries(world.deps, admin, 3)).toEqual({
      created: ['according to'],
      skipped,
      remaining: 0,
    })
    expect(await importCoreEntries(world.deps, admin, 3)).toEqual({ created: [], skipped, remaining: 0 })

    expect(world.entries.map((entry) => [entry.lemma, entry.createdBy])).toEqual([
      ['cove', 'admin:admin-1'],
      ['I', 'agent:agent-c'],
      ['a', 'agent:agent-c'],
      ['bank', 'agent:agent-c'],
      ['according to', 'admin:admin-1'],
    ])
    const batches = []
    for (const entry of world.entries) batches.push((await world.deps.nodes.admission(entry.id)).batch)
    expect(batches).toEqual([3, 1, 1, 1, 1])
    expect(world.facts).toEqual([])
  })

  it('filters the import by rule and records a merged American spelling on the British entry it creates [spec: catalog/import-filter]', async () => {
    const world = fakeWorld()
    const a1 = { frequency: null, cefr: [{ pos: 'noun' as const, level: 'A1' as const, source_id: 'cefrj' }] }
    for (const lemma of ['colour', 'color', 'centre', "'s", "can't", 'a.m.', '3D', 'honor', 'floor', 'flour'])
      world.references.set(lemma, a1)
    await createEntry(world.deps, admin, { lemma: 'honour', batch: 1 })
    const result = await importCoreEntries(world.deps, curatorAgent, 50)
    expect(result.skipped).toEqual({
      letters: [],
      contractions: ["'s", "can't"],
      characters: ['3D', 'a.m.'],
      inflections: [],
      variants: [
        { lemma: 'color', of: 'colour' },
        { lemma: 'honor', of: 'honour' },
      ],
    })
    expect(result.created).toEqual(['centre', 'colour', 'floor', 'flour'])
    const colour = world.entries.find((entry) => entry.lemma === 'colour')
    expect(world.facts).toEqual([
      expect.objectContaining({
        kind: 'form',
        subjectId: colour?.id,
        payload: { form: 'color', type: 'variant' },
        status: 'published',
        review: expect.objectContaining({ reviewer: 'curator' }),
      }),
    ])
  })

  it('takes an admitted entry off the wordlist unless a published list names it [spec: catalog/retire]', async () => {
    const world = fakeWorld()
    const give = await headword(world, 'give', [{ pos: 'verb', gloss: 'to hand something to someone' }])
    const { entry: rare } = await createEntry(world.deps, admin, { lemma: 'fabulate', batch: 1 })
    await expect(retireEntry(world.deps, agentA, rare.id)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(retireEntry(world.deps, admin, crypto.randomUUID() as EntryId)).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(retireEntry(world.deps, admin, rare.id)).resolves.toEqual({ entry: rare, retired: true })
    expect(world.work.get(rare.id)?.live).toBe(false)
    await expect(retireEntry(world.deps, admin, rare.id)).resolves.toEqual({ entry: rare, retired: false })
    await submitFact(world.deps, agentA, {
      kind: 'phrases',
      subject_id: give.entry.id,
      payload: { phrases: [{ type: 'phrasal_verb', text: 'give up' }] },
    })
    await drainReviews(world)
    const giveUp = world.entries.find((entry) => entry.lemma === 'give up')
    await expect(retireEntry(world.deps, admin, giveUp?.id as EntryId)).rejects.toMatchObject({ code: 'conflict' })
    // Admitting it again brings it back.
    await createEntry(world.deps, admin, { lemma: 'fabulate', batch: 1 })
    expect(world.work.get(rare.id)?.live).toBe(true)
  })
})

describe('public reads', () => {
  async function publishedBank() {
    const world = fakeWorld()
    const bank = await headword(world, 'bank', [{ pos: 'noun', gloss: 'land beside a river' }])
    const entry = bank.entry
    const sense = { id: bank.senses[0] as SenseId }
    await submitFact(world.deps, agentA, {
      kind: 'form',
      subject_id: entry.id,
      payload: { form: 'banks', type: 'plural' },
    })
    await reviewAll(world)
    return { world, entry, sense }
  }

  const none = { lang: null, review: false }
  const zh = { lang: 'zh', review: false }

  it('returns a published entry and 404s an unknown lemma with no fallback [spec: catalog/no-fallback]', async () => {
    const { world } = await publishedBank()
    await expect(publicEntryOf(world.deps, 'bank')).resolves.toMatchObject({
      lemma: 'bank',
      meanings: [{ pos: 'noun', forms: { plural: [{ form: 'banks', irregular: false }] } }],
    })
    await expect(publicEntryOf(world.deps, 'banks')).rejects.toMatchObject({ code: 'not_found' })
    await expect(publicEntryOf(world.deps, 'Bank')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('reads a public sentence from the documents that show it, and 404s any other [spec: public-view/sentence]', async () => {
    const { world, sense } = await publishedBank()
    const example = async (text: string) =>
      (await submitFact(world.deps, agentA, { kind: 'example', subject_id: sense.id, payload: { text } })).fact
    const shown = await example('We sat on the bank.')
    const sentence = shown.objectId as SentenceId
    await submitFact(world.deps, agentA, {
      kind: 'translation',
      subject_id: sentence,
      payload: { language: 'zh', of: 'sentence', text: '我们坐在河岸上。' },
    })
    await reviewAll(world)
    const bank = world.entries.find((entry) => entry.lemma === 'bank')
    await submitFact(world.deps, agentA, {
      kind: 'phrases',
      subject_id: bank?.id as string,
      payload: { phrases: [{ type: 'saying', text: 'Never bank on luck.' }] },
    })
    await reviewAll(world)
    const saying = world.sentences.find((one) => one.text === 'Never bank on luck.')?.id as SentenceId
    await submitFact(world.deps, agentA, {
      kind: 'sentence_meaning',
      subject_id: saying,
      payload: { gloss: 'Do not rely on chance.' },
    })
    await reviewAll(world)

    const read = await getPublicSentence(world.deps, sentence, zh)
    expect(read.versions).toHaveLength(1)
    expect(read.read()).toEqual({
      lang: 'zh',
      id: sentence,
      text: 'We sat on the bank.',
      source: null,
      meaning: null,
      translation: '我们坐在河岸上。',
      examples_of: [{ lemma: 'bank', sense_id: sense.id }],
      saying_of: [],
    })
    expect((await getPublicSentence(world.deps, saying, none)).read()).toMatchObject({
      text: 'Never bank on luck.',
      meaning: 'Do not rely on chance.',
      examples_of: [],
      saying_of: ['bank'],
    })
    // A pending example, an unknown id, and a sentence no public document shows are not found.
    world.failReviews()
    const pending = await example('A pending bank.')
    await expect(getPublicSentence(world.deps, pending.objectId as SentenceId, none)).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(getPublicSentence(world.deps, crypto.randomUUID() as SentenceId, none)).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('404s an entry that exists but is not yet published', async () => {
    const world = fakeWorld()
    await createEntry(world.deps, admin, { lemma: 'pending', batch: 1 })
    await expect(publicEntryOf(world.deps, 'pending')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('versions an entry by its document and what other entries supply, and shapes it per variant', async () => {
    const { world } = await publishedBank()
    const read = await getPublicEntry(world.deps, 'bank', none)
    // The digest, what other entries supply, and the taxonomy the topic categories are joined from.
    expect(read.versions).toEqual([
      expect.any(String),
      JSON.stringify({ phrases: [], family: [], publicParts: [] }),
      expect.stringContaining('"hospital-doctor",{"id":"body-health"'),
    ])
    expect(read.read()).toMatchObject({
      lang: null,
      lemma: 'bank',
      phrase_type: null,
      phrases: { by_sense: [], phrasal_verbs: [], idioms: [], compounds: [], sayings: [] },
    })
    expect(read.read().review).toBeUndefined()
    expect((await getPublicEntry(world.deps, 'bank', { lang: 'zh', review: true })).read().review).toBeDefined()
  })

  it('finds entries by an exact published form only [spec: catalog/form-lookup]', async () => {
    const { world } = await publishedBank()
    const found = await lookupForm(world.deps, 'banks', none)
    expect(found.versions).toEqual([expect.any(String)])
    expect(found.read()).toEqual([
      {
        lemma: 'bank',
        pos: ['noun'],
        cefr: null,
        gloss: 'land beside a river',
        image_url: null,
        matches: [{ type: 'plural', pos: 'noun' }],
      },
    ])
    await expect(lookupForm(world.deps, 'bankz', none)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('groups every form of one entry that matched, with its part of speech', async () => {
    const world = fakeWorld()
    const { entry } = await headword(world, 'record', [
      { pos: 'noun', gloss: 'A written account.' },
      { pos: 'verb', gloss: 'To write down.' },
    ])
    for (const type of ['plural', 'third_person_singular'] as const) {
      await submitFact(world.deps, agentA, { kind: 'form', subject_id: entry.id, payload: { form: 'records', type } })
    }
    await reviewAll(world)
    const found = await lookupForm(world.deps, 'records', none)
    expect(found.read()).toEqual([
      expect.objectContaining({
        lemma: 'record',
        pos: ['noun', 'verb'],
        matches: expect.arrayContaining([
          { type: 'plural', pos: 'noun' },
          { type: 'third_person_singular', pos: 'verb' },
        ]),
      }),
    ])
    expect(found.read()[0]?.matches).toHaveLength(2)
  })

  it('lists the members of a public category through every layer asked for, nearest first [spec: public-view/members]', async () => {
    const world = fakeWorld()
    const noun = (lemma: string) => senseOf(world, lemma, { pos: 'noun', gloss: `A ${lemma}.` })
    const [animal, bird, eagle, raptor] = [
      await noun('animal'),
      await noun('bird'),
      await noun('eagle'),
      await noun('raptor'),
    ]
    const relate = (from: SenseId, to: SenseId, domain?: 'biology') =>
      submitFact(world.deps, agentA, {
        kind: 'relation',
        subject_id: from,
        payload: { type: 'hypernym', target_sense_id: to, ...(domain ? { domain } : {}) },
      })
    await relate(bird, animal)
    await relate(eagle, bird)
    await relate(raptor, animal, 'biology')
    await reviewAll(world)
    const members = async (domain: 'biology' | null, cursor?: string) =>
      listSenseMembers(world.deps, animal, domain, { limit: 1, cursor }, zh)
    const first = await members(null)
    expect(first.items).toEqual([
      expect.objectContaining({ lemma: 'bird', sense_id: bird, depth: 1, gloss: 'A bird.', parents: [animal] }),
    ])
    expect(first.total).toBe(2)
    const second = await members(null, first.nextCursor ?? undefined)
    expect([second.items.map((item) => [item.lemma, item.depth, item.parents]), second.nextCursor]).toEqual([
      [['eagle', 2, [bird]]],
      null,
    ])
    expect(second.total).toBe(2)
    const all = await listSenseMembers(world.deps, animal, 'biology', { limit: 10 }, zh)
    expect(all.items.map((item) => item.lemma)).toEqual(['bird', 'raptor', 'eagle'])
    expect(all.total).toBe(3)
    // A member of two categories names both; a parent outside the layers walked is left out.
    await relate(eagle, raptor)
    await reviewAll(world)
    const parentsOf = async (domain: 'biology' | null) =>
      (await listSenseMembers(world.deps, animal, domain, { limit: 10 }, zh)).items.find(
        (item) => item.lemma === 'eagle',
      )?.parents
    expect(await parentsOf('biology')).toEqual([bird, raptor].sort())
    expect(await parentsOf(null)).toEqual([bird])
    await expect(listSenseMembers(world.deps, 'missing' as SenseId, null, { limit: 10 }, zh)).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('reads the overviews of many lemmas in the order asked, and names the ones without an entry [spec: public-view/overviews]', async () => {
    const { world, sense } = await publishedBank()
    await headword(world, 'shore', [{ pos: 'noun', gloss: 'the land along a sea' }])
    await submitFact(world.deps, agentA, {
      kind: 'translation',
      subject_id: sense.id,
      payload: { language: 'zh', of: 'sense', text: '河岸' },
    })
    await reviewAll(world)
    const lemmas = ['shore', ' Bank', 'bank', 'shore', 'banks']
    const read = await listEntryOverviews(world.deps, lemmas, 4, zh)
    // Versioned by the sense limit and, in the order asked, each document's digest or what is missing.
    expect(read.versions).toEqual([
      '4',
      expect.stringMatching(/^digest/),
      'missing: Bank',
      expect.stringMatching(/^digest/),
      'missing:banks',
    ])
    expect((await listEntryOverviews(world.deps, lemmas, 2, zh)).versions[0]).toBe('2')
    const found = read.read()
    expect(found.items.map((item) => item.lemma)).toEqual(['shore', 'bank'])
    // Exact lemmas only: a different case or an inflected form is missing, as it was spelled.
    expect(found.missing).toEqual([' Bank', 'banks'])
    expect(found.items[1]).toMatchObject({
      lemma: 'bank',
      meanings: [
        {
          pos: 'noun',
          sense_count: 1,
          senses: [{ id: sense.id, gloss: 'land beside a river', rare: false, translations: ['河岸'] }],
        },
      ],
    })
    expect((await listEntryOverviews(world.deps, ['nothing'], 4, none)).read()).toEqual({
      items: [],
      missing: ['nothing'],
    })
  })

  it('shows the category of a topic tag on the entry and the sense [spec: public-view/topic-category]', async () => {
    const { world, sense } = await publishedBank()
    await submitFact(world.deps, agentA, {
      kind: 'topic',
      subject_id: sense.id,
      payload: { topic_id: 'furniture' as TopicId },
    })
    await reviewAll(world)
    const category = { id: 'home', name: { en: 'Home', zh: 'Home (zh)' } }
    const entry = (await getPublicEntry(world.deps, 'bank', zh)).read()
    expect(entry.meanings[0]?.senses[0]?.topics).toEqual([
      { id: 'furniture', name: { en: 'Furniture', zh: 'Furniture (zh)' }, category },
    ])
    expect((await getPublicSense(world.deps, sense.id, zh)).read().topics[0]?.category).toEqual(category)
  })

  it('gets a published sense in the requested language and 404s unknown or hidden ones', async () => {
    const { world, sense } = await publishedBank()
    await submitFact(world.deps, agentA, {
      kind: 'translation',
      subject_id: sense.id,
      payload: { language: 'zh', of: 'sense', text: '河岸' },
    })
    await reviewAll(world)
    const found = await getPublicSense(world.deps, sense.id, zh)
    expect(found.versions).toEqual([expect.any(String), expect.stringContaining('"body-health"')])
    expect(found.read()).toMatchObject({
      lang: 'zh',
      id: sense.id,
      pos: 'noun',
      translations: ['河岸'],
      entry: { lemma: 'bank', translation: '河岸' },
    })
    await expect(getPublicSense(world.deps, 'missing' as SenseId, zh)).rejects.toMatchObject({ code: 'not_found' })
  })

  const everyEntry: EntryListFilter = { prefix: '', levels: [], pos: null, topic: null }

  it('lists published entries by normalized prefix, as summaries', async () => {
    const { world } = await publishedBank()
    await createEntry(world.deps, admin, { lemma: 'banner', batch: 1 })
    await expect(
      listPublicEntries(world.deps, { ...everyEntry, prefix: ' ba' }, 'lemma', { limit: 10 }, none),
    ).resolves.toEqual({
      items: [{ lemma: 'bank', pos: ['noun'], cefr: null, gloss: 'land beside a river', image_url: null }],
      nextCursor: null,
    })
  })

  it('filters entries by level, part of speech, and topic, and sorts them by frequency [spec: public-view/list-filters]', async () => {
    const world = fakeWorld()
    world.referenceSources.push({
      id: 'cefrj',
      name: 'CEFR-J Wordlist',
      version: '1.6',
      license: 'Custom',
      license_url: 'https://www.cefr-j.org/download.html',
      changes: 'None.',
      attribution: 'CEFR-J',
      url: 'https://www.cefr-j.org/',
      retrieved_at: '2026-11-09',
    })
    const reference = (rank: number | null, pos: 'noun' | 'verb', level: 'A1' | 'B2') => ({
      frequency: rank === null ? null : { zipf: 5, rank, source_id: 'wordfreq' as const },
      cefr: [{ pos, level, source_id: 'cefrj' as const }],
    })
    world.references.set('house', reference(300, 'noun', 'A1'))
    world.references.set('run', reference(120, 'verb', 'A1'))
    world.references.set('hut', reference(null, 'noun', 'B2'))
    const senses = new Map<string, SenseId>()
    for (const [lemma, pos, gloss] of [
      ['house', 'noun', 'a building people live in'],
      ['run', 'verb', 'to move fast on foot'],
      ['hut', 'noun', 'a small simple house'],
    ] as const) {
      senses.set(lemma, await senseOf(world, lemma, { pos, gloss }))
    }
    for (const lemma of ['house', 'hut'] as const) {
      const sense = senses.get(lemma) as SenseId
      await submitFact(world.deps, agentA, {
        kind: 'topic',
        subject_id: sense,
        payload: { topic_id: 'furniture' as TopicId },
      })
    }
    await reviewAll(world)
    const lemmas = async (filter: Partial<EntryListFilter>, sort: 'lemma' | 'frequency' = 'lemma') =>
      (await listPublicEntries(world.deps, { ...everyEntry, ...filter }, sort, { limit: 10 }, none)).items.map(
        (item) => item.lemma,
      )
    expect(await lemmas({})).toEqual(['house', 'hut', 'run'])
    expect(await lemmas({}, 'frequency')).toEqual(['run', 'house', 'hut'])
    expect(await lemmas({ levels: ['A1'] })).toEqual(['house', 'run'])
    expect(await lemmas({ levels: ['A1'], pos: 'noun' })).toEqual(['house'])
    expect(await lemmas({ pos: 'verb' })).toEqual(['run'])
    expect(await lemmas({ topic: 'furniture' as TopicId })).toEqual(['house', 'hut'])
    expect(await lemmas({ topic: 'home' as TopicId, levels: ['B2'] })).toEqual(['hut'])
    expect(await lemmas({ topic: 'furniture' as TopicId, pos: 'verb' })).toEqual([])
    await expect(lemmas({ topic: 'no-such-topic' as TopicId })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('searches lemmas, glosses, translations in the read language, and examples, in rank order [spec: search/rank]', async () => {
    const { world, sense } = await publishedBank()
    const person = { id: await senseOf(world, 'banker', { pos: 'noun', gloss: 'a person who runs a bank' }) }
    const coast = { id: await senseOf(world, 'shore', { pos: 'noun', gloss: 'land along the sea' }) }
    for (const [subject, payload] of [
      [sense.id, { language: 'zh', of: 'sense', text: '河岸' }],
      [person.id, { language: 'zh', of: 'sense', text: '银行家' }],
    ] as const) {
      await submitFact(world.deps, agentA, { kind: 'translation', subject_id: subject, payload })
    }
    await submitFact(world.deps, agentA, {
      kind: 'example',
      subject_id: coast.id,
      payload: { text: 'We walked along the river bank to the shore.' },
    })
    await reviewAll(world)
    const search = async (text: string, variant: ReadVariant = none) =>
      (await searchPublicEntries(world.deps, text, { limit: 10 }, variant)).items.map(({ lemma, match }) => ({
        lemma,
        match,
      }))
    expect(await search(' bank ')).toEqual([
      { lemma: 'bank', match: 'lemma' },
      { lemma: 'banker', match: 'lemma' },
      { lemma: 'shore', match: 'example' },
    ])
    expect(await search('river')).toEqual([
      { lemma: 'bank', match: 'gloss' },
      { lemma: 'shore', match: 'example' },
    ])
    expect(await search('银行', zh)).toEqual([{ lemma: 'banker', match: 'translation' }])
    expect(await search('银行')).toEqual([])
    expect(await search('bnak')).toEqual([])
    expect((await searchPublicEntries(world.deps, 'bank', { limit: 1 }, zh)).items).toEqual([
      {
        lemma: 'bank',
        pos: ['noun'],
        cefr: null,
        gloss: 'land beside a river',
        translation: '河岸',
        image_url: null,
        match: 'lemma',
      },
    ])
    await expect(searchPublicEntries(world.deps, 'bank', { limit: 1 }, { lang: 'all', review: false })).rejects.toThrow(
      'one language',
    )
  })
})

describe('management reads', () => {
  it('lists entries in every state by normalized prefix, with their live inventory size', async () => {
    const world = fakeWorld()
    await headword(world, 'bank', [
      { pos: 'noun', gloss: 'land beside a river' },
      { pos: 'noun', gloss: 'a place that keeps money' },
    ])
    for (const lemma of ['banner', 'cat']) await createEntry(world.deps, admin, { lemma, batch: 1 })
    const filter = { prefix: ' ba', level: null, stuck: false }
    const page = await listEntrySummaries(world.deps, filter, { limit: 10 })
    expect(page.items.map(({ lemma, live, sense_count }) => ({ lemma, live, sense_count }))).toEqual([
      { lemma: 'bank', live: true, sense_count: 2 },
      { lemma: 'banner', live: true, sense_count: 0 },
    ])
  })

  it('shows every fact in every status with the scores, without duplicating a stored relation inside the entry', async () => {
    const world = fakeWorld()
    const big = await headword(world, 'big', [
      { pos: 'adjective', gloss: 'large in size' },
      { pos: 'adjective', gloss: 'important or serious' },
    ])
    const [a, b] = big.senses as [SenseId, SenseId]
    // Submission refuses relations inside one entry; facts stored before that rule still show once.
    const inventory = big.inventory
    if (!inventory) throw new Error('No inventory.')
    await world.deps.facts.insert({
      ...inventory,
      id: crypto.randomUUID() as FactId,
      kind: 'relation',
      subjectId: a,
      objectId: b,
      contentKey: `synonym|${b}`,
      payload: { type: 'synonym', target_sense_id: b },
      status: 'pending',
      review: null,
    })
    const view = await getManagedEntry(world.deps, 'big')
    expect(view).toMatchObject({ entry: { lemma: 'big', live: true }, batch: 1, frequency: null, cefr: [] })
    expect(view.senses).toHaveLength(2)
    expect(view.facts.map((fact) => [fact.kind, fact.status]).sort()).toEqual([
      ['relation', 'pending'],
      ['senses', 'published'],
    ])
    expect(view.completeness).toBeGreaterThanOrEqual(0)
    expect(view.credibility).toBeLessThanOrEqual(1)
    await expect(getManagedEntry(world.deps, 'small')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('locates the entry that owns an entry or sense id, and 404s any other id', async () => {
    const world = fakeWorld()
    const bank = await headword(world, 'bank', [{ pos: 'noun', gloss: 'land beside a river' }])
    const owner = { id: bank.entry.id, lemma: 'bank' as Lemma }
    await expect(locateNode(world.deps, bank.entry.id)).resolves.toEqual({ node_type: 'entry', entry: owner })
    await expect(locateNode(world.deps, bank.senses[0] as string)).resolves.toEqual({
      node_type: 'sense',
      entry: owner,
    })
    await expect(locateNode(world.deps, crypto.randomUUID())).rejects.toMatchObject({ code: 'not_found' })
  })
})
