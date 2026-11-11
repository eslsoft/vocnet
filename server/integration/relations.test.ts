import { env } from 'cloudflare:test'
import { createEntryResultSchema, createSenseResultSchema, publicEntrySchema } from '@shared/catalog'
import { factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminToken, call, deliverPendingReviews, issueAgentKey, stubReviewers } from './helpers'

async function agent() {
  const token = await issueAgentKey()
  const post = (path: string, json: unknown) => call(path, { method: 'POST', token, json })
  /** Creates an entry with one noun sense per gloss and returns the sense ids. */
  const entry = async (lemma: string, ...glosses: string[]) => {
    const { entry } = createEntryResultSchema.parse((await post('/manage/v1/entries', { lemma })).body)
    const ids: string[] = []
    for (const gloss of glosses) {
      const created = await post('/manage/v1/senses', { entry_id: entry.id, pos: 'noun', gloss })
      ids.push(createSenseResultSchema.parse(created.body).sense.id)
    }
    return ids
  }
  const relate = (type: string, from: string, to: string) =>
    post('/manage/v1/facts', { kind: 'relation', subject_id: from, payload: { type, target_sense_id: to } })
  return { entry, relate, post }
}

const statusOf = async (id: string) =>
  (await env.DB.prepare('SELECT status FROM facts WHERE id = ?').bind(id).first<{ status: string }>())?.status

const revisionOf = async (lemma: string) =>
  (
    await env.DB.prepare('SELECT revision FROM worklist JOIN entries ON entries.id = worklist.entry_id WHERE lemma = ?')
      .bind(lemma)
      .first<{ revision: number }>()
  )?.revision

describe('relations at a sense that stops showing', () => {
  afterEach(() => vi.restoreAllMocks())

  it('retracts the relations of a sense whose gloss or entry fact leaves live, in the same batch [spec: facts/dead-sense-retires-links-api]', async () => {
    const { entry, relate } = await agent()
    const [nation] = await entry('nation', 'A large group of people sharing a country.')
    const [people] = await entry('people', 'A group sharing a nationality.')
    const [country] = await entry('country', 'A land with its own government.')
    const [state] = await entry('state', 'A nation with its own government.')
    const [land] = await entry('land', 'The ground of a country.')
    const ids = async (type: string, from: string, to: string) =>
      factWriteResultSchema.parse((await relate(type, from, to)).body).fact.id
    const outgoing = await ids('synonym', people as string, nation as string)
    const incoming = await ids('hypernym', nation as string, country as string)
    const unrelated = await ids('synonym', country as string, state as string)
    const viaEntry = await ids('part_of', land as string, state as string)
    stubReviewers()
    await deliverPendingReviews()
    const admin = await adminToken()
    const glossOf = async (sense: string) =>
      (
        await env.DB.prepare("SELECT id FROM facts WHERE kind = 'sense' AND subject_id = ?")
          .bind(sense)
          .first<{ id: string }>()
      )?.id as string
    const peopleBefore = await revisionOf('people')

    const retract = await call(`/manage/v1/facts/${await glossOf(nation as string)}/retract`, {
      method: 'POST',
      token: admin,
    })
    expect(retract.status).toBe(200)
    expect([await statusOf(outgoing), await statusOf(incoming), await statusOf(unrelated)]).toEqual([
      'retracted',
      'retracted',
      'published',
    ])
    expect(await revisionOf('people')).toBeGreaterThan(peopleBefore ?? 0)

    const stateEntry = await env.DB.prepare(
      "SELECT facts.id FROM facts JOIN entries ON entries.id = facts.subject_id WHERE facts.kind = 'entry' AND lemma = 'state'",
    ).first<{ id: string }>()
    await call(`/manage/v1/facts/${stateEntry?.id}/retract`, { method: 'POST', token: admin })
    expect([await statusOf(unrelated), await statusOf(viaEntry)]).toEqual(['retracted', 'retracted'])
    const people2 = publicEntrySchema.parse((await call('/v1/entries/people')).body)
    expect(people2.meanings[0]?.senses[0]?.relations.synonyms).toEqual([])
  })
})

describe('dead_end_relations migration', () => {
  it('retracts live relations at a sense that cannot show and returns their relation items to the producers [spec: facts/dead-end-relations-migration]', async () => {
    const { entry, relate } = await agent()
    const [nation] = await entry('nation', 'A large group of people sharing a country.')
    const [people] = await entry('people', 'A group sharing a nationality.')
    const [country] = await entry('country', 'A land with its own government.')
    const [state] = await entry('state', 'A nation with its own government.')
    const ids = async (type: string, from: string, to: string) =>
      factWriteResultSchema.parse((await relate(type, from, to)).body).fact.id
    const dangling = await ids('synonym', people as string, nation as string)
    const kept = await ids('synonym', country as string, state as string)
    await env.DB.prepare("UPDATE facts SET status = 'published' WHERE kind IN ('entry', 'sense', 'relation')").run()
    // The state before the rule: the gloss left live and its relations stayed published.
    await env.DB.prepare("UPDATE facts SET status = 'retracted' WHERE kind = 'sense' AND subject_id = ?")
      .bind(nation)
      .run()
    const item = (type: string, subject: string, attempts: number) =>
      env.DB.prepare(
        `INSERT INTO work_items (id, entry_id, type, subject_id, gap, stage, rank, zipf_order, awaiting, attempts, worked, created_at)
         SELECT ?, entry_id, ?, id, ?, 2, 2, -1, 0, ?, 0, '2026-01-01T00:00:00.000Z' FROM senses WHERE id = ?`,
      )
        .bind(crypto.randomUUID(), type, JSON.stringify({ type, sense_id: subject }), attempts, subject)
        .run()
    await env.DB.prepare('DELETE FROM work_items').run()
    await item('synonyms', people as string, 3)
    await item('topics', people as string, 3)
    await item('synonyms', country as string, 3)
    const before = {
      people: await revisionOf('people'),
      nation: await revisionOf('nation'),
      state: await revisionOf('state'),
    }

    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name.endsWith('_dead_end_relations.sql'))
    if (!migration) throw new Error('The dead_end_relations migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()

    expect([await statusOf(dangling), await statusOf(kept)]).toEqual(['retracted', 'published'])
    const attempts = await env.DB.prepare(
      'SELECT type, subject_id AS subject, attempts FROM work_items ORDER BY type, subject_id',
    ).all<{ type: string; subject: string; attempts: number }>()
    expect(attempts.results.map(({ type, subject, attempts }) => [type, subject, attempts]).sort()).toEqual(
      [
        ['synonyms', people, 0],
        ['synonyms', country, 3],
        ['topics', people, 3],
      ].sort(),
    )
    expect(await revisionOf('people')).toBe((before.people ?? 0) + 1)
    expect(await revisionOf('nation')).toBe((before.nation ?? 0) + 1)
    expect(await revisionOf('state')).toBe(before.state)
  })
})

describe('relation write rules', () => {
  it('refuses a second relation type to the same entry and a hypernym 2-cycle with 422 [spec: facts/relation-write-rules-api]', async () => {
    const { entry, relate } = await agent()
    const [number] = await entry('number', 'A quantity of people or things.')
    const [quantity, measure] = await entry('quantity', 'An amount of something.', 'A measurable property.')
    const synonym = await relate('synonym', quantity as string, number as string)
    expect(synonym.status).toBe(201)
    const { fact } = factWriteResultSchema.parse(synonym.body)

    const second = await relate('hypernym', number as string, measure as string)
    expect(second.status).toBe(422)
    expect(apiErrorSchema.parse(second.body)).toMatchObject({
      error: {
        code: 'invalid_reference',
        message: expect.stringContaining(`already has a live synonym relation (${fact.id})`),
      },
    })

    const [shock] = await entry('shock', 'An unexpected upsetting event.')
    const [surprise] = await entry('surprise', 'An unexpected event.')
    expect((await relate('hypernym', shock as string, surprise as string)).status).toBe(201)
    const cycle = await relate('hypernym', surprise as string, shock as string)
    expect(cycle.status).toBe(422)
    expect(apiErrorSchema.parse(cycle.body).error.message).toContain('cannot each be a kind of the other')
  })
})

describe('relations_strict_revalidate migration', () => {
  it('marks weakly reviewed and conflicting published relations for revalidation [spec: facts/relations-strict-revalidate]', async () => {
    const { entry } = await agent()
    const [person] = await entry('person', 'A human being.')
    const [princess] = await entry('princess', 'A woman who rules a principality.')
    const [cop] = await entry('cop', 'A police officer.')
    const [lord] = await entry('lord', 'A nobleman.')
    const [head, cap] = await entry('head', 'The upper part of the body.', 'The top of something.')
    const [sole] = await entry('sole', 'The bottom of a shoe.')
    const [outsole] = await entry('outsole', 'The outer bottom of a shoe.')
    const [wheel] = await entry('wheel', 'A round frame that turns.')
    const [car] = await entry('car', 'A road vehicle.')
    const [shock] = await entry('shock', 'An unexpected upsetting event.')
    const [surprise] = await entry('surprise', 'An unexpected event.')
    const jevThenLlm = (jev: number) =>
      JSON.stringify({
        reviewer: 'jev+llm',
        detail: {
          opinions: [
            { reviewer: 'jev', confidence: jev },
            { reviewer: 'llm', confidence: 0.9 },
          ],
        },
      })
    const jevAlone = JSON.stringify({ reviewer: 'jev', confidence: 0.95, detail: {} })
    const insert = async (type: string, subject: unknown, object: unknown, review: string) => {
      const id = crypto.randomUUID()
      await env.DB.prepare(
        `insert into facts (id, kind, subject_id, object_id, content_key, payload, status, exclusive, author, review, created_at, updated_at)
         values (?, 'relation', ?, ?, ?, ?, 'published', 0, 'agent:legacy', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
        .bind(id, subject, object, `${type}|${object}`, JSON.stringify({ type, target_sense_id: object }), review)
        .run()
      return id
    }
    const marked = {
      princessHead: await insert('part_of', head, princess, jevAlone),
      chainHead: await insert('part_of', head, lord, jevThenLlm(0.7)),
      copHead: await insert('part_of', head, cop, jevThenLlm(0.6)),
      lowJev: await insert('synonym', outsole, sole, jevThenLlm(0.2)),
      crowdedSynonym: await insert('synonym', cap, car, jevAlone),
      crowdedPart: await insert('part_of', cap, car, jevAlone),
      cycleUp: await insert('hypernym', shock, surprise, jevAlone),
      cycleDown: await insert('hypernym', surprise, shock, jevAlone),
    }
    await insert('hypernym', lord, person, jevAlone)
    const kept = {
      wheel: await insert('part_of', wheel, car, jevThenLlm(0.6)),
      person: await insert('part_of', head, person, jevAlone),
    }

    await env.DB.prepare("update facts set status = 'published' where kind in ('entry', 'sense')").run()
    const migration = env.TEST_MIGRATIONS.find((candidate) =>
      candidate.name.endsWith('_relations_strict_revalidate.sql'),
    )
    if (!migration) throw new Error('The relations_strict_revalidate migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()

    const mark = (id: string) =>
      env.DB.prepare('SELECT revalidate_since AS mark FROM facts WHERE id = ?')
        .bind(id)
        .first<{ mark: string | null }>()
    for (const id of Object.values(marked)) expect((await mark(id))?.mark).toEqual(expect.any(String))
    for (const id of Object.values(kept)) expect((await mark(id))?.mark).toBeNull()
  })
})

describe('variant_spelling_merge migration', () => {
  it('retracts spelling-variant entries and records the variant on the British entry [spec: facts/variant-spelling-merge]', async () => {
    const token = await issueAgentKey()
    const post = (path: string, json: unknown) => call(path, { method: 'POST', token, json })
    const entries: Record<string, { id: string; factId: string }> = {}
    for (const lemma of ['colour', 'color', 'theatre', 'theater', 'story', 'storey']) {
      const { entry, fact } = createEntryResultSchema.parse((await post('/manage/v1/entries', { lemma })).body)
      entries[lemma] = { id: entry.id, factId: fact.id }
    }
    const theatre = entries.theatre?.id as string
    await post('/manage/v1/facts', { kind: 'form', subject_id: theatre, payload: { form: 'theater', type: 'variant' } })
    const revision = (id: string) =>
      env.DB.prepare('SELECT revision, live FROM worklist WHERE entry_id = ?')
        .bind(id)
        .first<{ revision: number; live: number }>()
    const before = await revision(entries.color?.id as string)

    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name.endsWith('_variant_spelling_merge.sql'))
    if (!migration) throw new Error('The variant_spelling_merge migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()

    const status = async (lemma: string) =>
      (
        await env.DB.prepare('SELECT status FROM facts WHERE id = ?')
          .bind(entries[lemma]?.factId)
          .first<{ status: string }>()
      )?.status
    expect(await status('color')).toBe('retracted')
    expect(await status('theater')).toBe('retracted')
    for (const lemma of ['colour', 'theatre', 'story', 'storey']) expect(await status(lemma)).toBe('pending')
    expect(await revision(entries.color?.id as string)).toEqual({ revision: (before?.revision ?? 0) + 1, live: 0 })
    const variants = await env.DB.prepare(
      "SELECT subject_id AS subject, payload, status, author FROM facts WHERE kind = 'form' ORDER BY subject_id",
    ).all<{ subject: string; payload: string; status: string; author: string }>()
    expect(
      variants.results.map(({ subject, payload, status }) => [subject, JSON.parse(payload), status]).sort(),
    ).toEqual(
      [
        [entries.colour?.id, { form: 'color', type: 'variant' }, 'pending'],
        [theatre, { form: 'theater', type: 'variant' }, 'pending'],
      ].sort(),
    )
    expect(
      await env.DB.prepare('SELECT name FROM sqlite_master WHERE name = ?').bind('variant_merge').first(),
    ).toBeNull()
  })
})

describe('syllables, form pronunciations, and example translations', () => {
  afterEach(() => vi.restoreAllMocks())

  it('validates, reviews, and serves the new fields in the entry document [spec: catalog/new-fields-api]', async () => {
    const token = await issueAgentKey()
    const post = (path: string, json: unknown) => call(path, { method: 'POST', token, json })
    const { entry } = createEntryResultSchema.parse((await post('/manage/v1/entries', { lemma: 'go' })).body)
    const { sense } = createSenseResultSchema.parse(
      (await post('/manage/v1/senses', { entry_id: entry.id, pos: 'verb', gloss: 'To move or travel.' })).body,
    )
    const submit = (kind: string, subject: string, payload: unknown) =>
      post('/manage/v1/facts', { kind, subject_id: subject, payload })
    expect((await submit('syllables', entry.id, { syllables: ['g', 'oo'] })).status).toBe(422)
    expect((await submit('syllables', entry.id, { syllables: ['go'] })).status).toBe(201)
    expect((await submit('form', entry.id, { form: 'went', type: 'past', ipa: '/went/', accent: 'us' })).status).toBe(
      400,
    )
    expect((await submit('form', entry.id, { form: 'went', type: 'past', ipa: 'went' })).status).toBe(400)
    expect((await submit('form', entry.id, { form: 'went', type: 'past', ipa: 'went', accent: 'us' })).status).toBe(201)
    expect(
      (await submit('example', sense.id, { text: 'We go home.', translations: { 'zh-Hant': '我們回家。' } })).status,
    ).toBe(400)
    expect(
      (await submit('example', sense.id, { text: 'We go home.', translations: { zh: '我们回家。' } })).status,
    ).toBe(201)
    stubReviewers()
    await deliverPendingReviews()

    const read = async (query: string) => publicEntrySchema.parse((await call(`/v1/entries/go${query}`)).body)
    const zh = await read('?lang=zh')
    expect(zh.syllables).toEqual(['go'])
    expect(zh.meanings[0]?.forms).toEqual({ past: [{ form: 'went', irregular: true, ipa: 'went', accent: 'us' }] })
    expect(zh.meanings[0]?.senses[0]?.examples).toEqual([{ text: 'We go home.', translation: '我们回家。' }])
    const all = await read('?lang=all')
    expect(all.meanings[0]?.senses[0]?.examples).toEqual([{ text: 'We go home.', translation: { zh: '我们回家。' } }])
    expect((await read('')).meanings[0]?.senses[0]?.examples).toEqual([{ text: 'We go home.' }])
  })
})
