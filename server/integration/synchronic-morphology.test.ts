import { env } from 'cloudflare:test'
import { createEntryResultSchema } from '@shared/catalog'
import { describe, expect, it } from 'vitest'
import { call, issueAgentKey } from './helpers'

const review = JSON.stringify({
  reviewer: 'llm',
  model: 'm',
  verdict: 'pass',
  confidence: 0.9,
  reason: 'Right.',
  context: {},
  detail: {},
  reviewed_at: '2026-01-01T00:00:00.000Z',
})

async function insertFormation(subject: string, parts: unknown[], status: string): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    `insert into facts (id, kind, subject_id, object_id, content_key, payload, status, exclusive, author, review, created_at, updated_at)
     values (?, 'morphology', ?, null, ?, ?, ?, 1, 'agent:test', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  )
    .bind(id, subject, id, JSON.stringify({ parts }), status, review)
    .run()
  return id
}

describe('synchronic morphology release', () => {
  it('re-judges published formations with a root and lifts every stall [spec: work/synchronic-morphology-migration]', async () => {
    const token = await issueAgentKey()
    const entryId = async (lemma: string) =>
      createEntryResultSchema.parse((await call('/manage/v1/entries', { method: 'POST', token, json: { lemma } })).body)
        .entry.id
    const section = await entryId('section')
    const water = await entryId('water')
    const spectator = await entryId('spectator')
    const root = await insertFormation(
      section,
      [
        { form: 'sect', role: 'root', meaning: 'cut' },
        { form: '-ion', role: 'suffix' },
      ],
      'published',
    )
    const simple = await insertFormation(water, [{ form: 'water', role: 'base' }], 'published')
    const rejected = await insertFormation(
      spectator,
      [
        { form: 'spect', role: 'root' },
        { form: '-ator', role: 'suffix' },
      ],
      'rejected',
    )
    await env.DB.prepare(
      `update worklist set scored_revision = revision, stalled = 1, claimed_work = '{"gaps":[]}'`,
    ).run()

    const migration = env.TEST_MIGRATIONS.find((candidate) =>
      candidate.name.endsWith('_synchronic_morphology_stalls.sql'),
    )
    if (!migration) throw new Error('The synchronic_morphology_stalls migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()

    const marked = async (id: string) =>
      (await env.DB.prepare('select revalidate_since from facts where id = ?').bind(id).first())?.revalidate_since
    expect(await marked(root)).toEqual(expect.any(String))
    expect(await marked(simple)).toBeNull()
    expect(await marked(rejected)).toBeNull()
    const rows = await env.DB.prepare(
      'select count(*) as n, sum(stalled) as stalled, sum(claimed_work is not null) as claimed, sum(revision = scored_revision) as fresh from worklist',
    ).first()
    expect(rows).toMatchObject({ stalled: 0, claimed: 0, fresh: 0 })
    expect(rows?.n).toBeGreaterThanOrEqual(3)
  })
})
