import { env } from 'cloudflare:test'
import { createEntryResultSchema, createSenseResultSchema } from '@shared/catalog'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { call, deliverPendingReviews, issueAgentKey, stubReviewers } from './helpers'

const itemTypesOf = async (subjectId: string) =>
  (
    await env.DB.prepare('SELECT type FROM work_items WHERE subject_id = ? ORDER BY type')
      .bind(subjectId)
      .all<{ type: string }>()
  ).results.map(({ type }) => type)

const revisionOf = async (entryId: string) =>
  (await env.DB.prepare('SELECT revision FROM worklist WHERE entry_id = ?').bind(entryId).first<{ revision: number }>())
    ?.revision

describe('core senses', () => {
  afterEach(() => vi.restoreAllMocks())

  it('opens the network and collocation items of the core senses alone once the sense list publishes [spec: work/core-senses-api]', async () => {
    const token = await issueAgentKey()
    const post = (path: string, json: unknown) => call(path, { method: 'POST', token, json })
    const { entry } = createEntryResultSchema.parse((await post('/manage/v1/entries', { lemma: 'clear' })).body)
    const senses: string[] = []
    for (const [pos, gloss] of [
      ['adjective', 'Easy to understand.'],
      ['adjective', 'Easy to see through.'],
      ['adjective', 'Free of anything that blocks the way.'],
      ['adjective', 'Without clouds.'],
      ['verb', 'To remove things from a place.'],
      ['verb', 'To become free of clouds.'],
    ]) {
      const created = await post('/manage/v1/senses', { entry_id: entry.id, pos, gloss })
      senses.push(createSenseResultSchema.parse(created.body).sense.id)
    }
    stubReviewers()
    await deliverPendingReviews()
    const [understand, through, free, cloudless, remove, clouds] = senses as [string, ...string[]]
    expect(await itemTypesOf(cloudless as string)).toContain('collocations')

    expect(
      (
        await post('/manage/v1/facts', {
          kind: 'sense_list',
          subject_id: entry.id,
          payload: { common: senses, extra: [] },
        })
      ).status,
    ).toBe(201)
    await deliverPendingReviews()

    const full = ['collocations', 'example_translations', 'examples', 'grammar', 'synonyms', 'translations']
    for (const core of [understand, through, free]) expect(await itemTypesOf(core as string)).toEqual(full)
    expect(await itemTypesOf(remove as string)).toEqual([...full, 'topics'].sort())
    const lean = ['example_translations', 'examples', 'grammar', 'translations']
    expect(await itemTypesOf(cloudless as string)).toEqual(lean)
    expect(await itemTypesOf(clouds as string)).toEqual(lean)
  })

  it('returns the curators items whose rules changed to the producers and marks every row stale [spec: work/core-senses-migration]', async () => {
    const token = await issueAgentKey()
    const { entry } = createEntryResultSchema.parse(
      (await call('/manage/v1/entries', { method: 'POST', token, json: { lemma: 'block' } })).body,
    )
    await env.DB.prepare('DELETE FROM work_items').run()
    const item = (type: string, attempts: number) =>
      env.DB.prepare(
        `INSERT INTO work_items (id, entry_id, type, subject_id, gap, stage, rank, zipf_order, awaiting, attempts, worked, created_at)
         VALUES (?, ?, ?, ?, ?, 2, 2, -1, 0, ?, 1, '2026-01-01T00:00:00.000Z')`,
      )
        .bind(crypto.randomUUID(), entry.id, type, crypto.randomUUID(), JSON.stringify({ type }), attempts)
        .run()
    for (const type of ['sense_list', 'topics', 'category', 'parts', 'synonyms', 'collocations']) await item(type, 3)
    await item('examples', 2)
    const before = await revisionOf(entry.id)

    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name.endsWith('_core_senses.sql'))
    if (!migration) throw new Error('The core_senses migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()

    const rows = await env.DB.prepare('SELECT type, attempts, worked FROM work_items ORDER BY type').all<{
      type: string
      attempts: number
      worked: number
    }>()
    expect(rows.results.map(({ type, attempts, worked }) => [type, attempts, worked])).toEqual([
      ['category', 0, 0],
      ['collocations', 3, 1],
      ['examples', 2, 1],
      ['parts', 0, 0],
      ['sense_list', 0, 0],
      ['synonyms', 0, 0],
      ['topics', 0, 0],
    ])
    expect(await revisionOf(entry.id)).toBe((before ?? 0) + 1)
  })
})
