import { env } from 'cloudflare:test'
import { createEntryResultSchema, createSenseResultSchema } from '@shared/catalog'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { call, deliverPendingReviews, issueAgentKey, stubReviewers } from './helpers'

const createEntry = async (token: string, lemma: string) =>
  createEntryResultSchema.parse((await call('/manage/v1/entries', { method: 'POST', token, json: { lemma } })).body)
const createSense = async (token: string, entryId: string, gloss: string) =>
  createSenseResultSchema.parse(
    (await call('/manage/v1/senses', { method: 'POST', token, json: { entry_id: entryId, pos: 'noun', gloss } })).body,
  )
const settle = async () => {
  const reviewers = stubReviewers()
  await deliverPendingReviews()
  reviewers.mockRestore()
}

const reject = (factId: string, reason: string, reviewer = 'llm') =>
  env.DB.prepare(
    `update facts set status = 'rejected', review = json_object('reviewer', ?, 'verdict', 'fail', 'reason', ?) where id = ?`,
  )
    .bind(reviewer, reason, factId)
    .run()

describe('proper noun re-review release', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns to pending the entry and sense facts rejected as proper names whose slot holds no live fact [spec: facts/proper-noun-rereview-migration]', async () => {
    const token = await issueAgentKey()
    const london = await createEntry(token, 'London')
    const ash = await createEntry(token, 'Ash Wednesday')
    const bread = await createEntry(token, 'bread')
    const facebook = await createEntry(token, 'Facebook')
    const paris = await createEntry(token, 'Paris')
    const pacific = await createEntry(token, 'pacific')
    const ocean = await createSense(token, pacific.entry.id, 'The largest ocean.')
    const calm = await createSense(token, pacific.entry.id, 'Peaceful.')
    await settle()

    await reject(london.fact.id, 'London is a proper name for a city, so it does not qualify.')
    await reject(ash.fact.id, 'Ash Wednesday is a PROPER NOUN of a Christian holy day.')
    await reject(bread.fact.id, 'An invented word.')
    await reject(facebook.fact.id, 'Facebook is a proper name of a company.', 'curator')
    // A rejected proper-name fact beside the live entry fact of its slot stays rejected.
    await env.DB.prepare(
      `insert into facts (id, kind, subject_id, object_id, content_key, payload, status, exclusive, supersedes_id, author, review, revalidate_since, created_at, updated_at)
       select 'old-paris', kind, subject_id, object_id, content_key, payload, 'rejected', exclusive, supersedes_id, author,
         json_object('reviewer', 'llm', 'verdict', 'fail', 'reason', 'Paris is the name of a place.'), null, created_at, updated_at
       from facts where id = ?`,
    )
      .bind(paris.fact.id)
      .run()
    await reject(ocean.fact.id, 'The gloss describes the Pacific, a capitalized proper name for the ocean.')
    await reject(calm.fact.id, 'Not a sense of this word.')
    await env.DB.prepare(`update worklist set live = 0 where entry_id in (?, ?, ?, ?)`)
      .bind(london.entry.id, ash.entry.id, bread.entry.id, facebook.entry.id)
      .run()
    await env.DB.prepare('update worklist set scored_revision = revision').run()

    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name.endsWith('_proper_noun_rereview.sql'))
    if (!migration) throw new Error('The proper_noun_rereview migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()

    const status = async (id: string) =>
      (await env.DB.prepare('select status from facts where id = ?').bind(id).first<{ status: string }>())?.status
    expect(await status(london.fact.id)).toBe('pending')
    expect(await status(ash.fact.id)).toBe('pending')
    expect(await status(ocean.fact.id)).toBe('pending')
    expect(await status(bread.fact.id)).toBe('rejected')
    expect(await status(facebook.fact.id)).toBe('rejected')
    expect(await status('old-paris')).toBe('rejected')
    expect(await status(paris.fact.id)).toBe('published')
    expect(await status(calm.fact.id)).toBe('rejected')

    const stuck = await env.DB.prepare(
      `select count(*) as n from facts where status = 'pending' and updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')`,
    ).first()
    expect(stuck).toEqual({ n: 3 })
    const rows = await env.DB.prepare(
      'select entry_id, live, revision = scored_revision as fresh from worklist order by entry_id',
    ).all<{ entry_id: string; live: number; fresh: number }>()
    const row = (entryId: string) => rows.results.find((candidate) => candidate.entry_id === entryId)
    expect(row(london.entry.id)).toMatchObject({ live: 1, fresh: 0 })
    expect(row(ash.entry.id)).toMatchObject({ live: 1, fresh: 0 })
    expect(row(pacific.entry.id)).toMatchObject({ live: 1, fresh: 0 })
    expect(row(bread.entry.id)).toMatchObject({ live: 0, fresh: 1 })
    expect(row(facebook.entry.id)).toMatchObject({ live: 0, fresh: 1 })
    expect(row(paris.entry.id)).toMatchObject({ live: 1, fresh: 1 })
  })
})
