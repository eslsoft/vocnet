import { applyD1Migrations, env, reset } from 'cloudflare:test'
import {
  publicEntryIdsSql,
  pushEntrySql,
  type ReplicaSource,
  readManifestSql,
  replicaManifestSql,
  sourceFingerprints,
  syncStatements,
  topicsReadSql,
  unitReadSql,
} from '@server/adapters/replica-sql'
import { ENTRY_UNIT_TABLES, planReplicaSync, type ReplicaRow } from '@server/domain/replica'
import { handleScheduled } from '@server/worker'
import { describe, expect, it } from 'vitest'
import { adminToken, call, deliverPendingReviews, headword, issueAgentKey, stubReviewers, submitOk } from './helpers'

// The suite's one D1 database plays both sides: a test reads the source's units, resets the
// database to an empty replica with the migrations applied, and applies the sync there.

const source: ReplicaSource = {
  publicEntryIds: async () =>
    (await env.DB.prepare(publicEntryIdsSql).all<{ entry_id: string }>()).results.map((row) => row.entry_id),
  unit: async (entryId) => ({
    entryId,
    rows: Object.fromEntries(
      await Promise.all(
        ENTRY_UNIT_TABLES.map(async ({ table }) => [
          table,
          (await env.DB.prepare(unitReadSql[table]).bind(entryId).all<ReplicaRow>()).results,
        ]),
      ),
    ),
  }),
  topics: async () => (await env.DB.prepare(topicsReadSql).all<ReplicaRow>()).results,
}

/** The fingerprints and the statements a sync to a replica holding `manifest` applies, read now. */
async function syncFromSource(manifest: ReadonlyMap<string, string>) {
  const fingerprints = await sourceFingerprints(source)
  const plan = planReplicaSync(fingerprints, manifest, [])
  const statements: string[] = []
  for await (const unit of syncStatements(source, plan, fingerprints, '2026-11-19T00:00:00.000Z')) {
    statements.push(...unit)
  }
  return { fingerprints, plan, statements }
}

async function emptyReplica() {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
}

async function apply(statements: string[]) {
  await env.DB.prepare(replicaManifestSql).run()
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)))
}

const replicaManifest = async () =>
  new Map(
    (await env.DB.prepare(readManifestSql).all<{ key: string; fingerprint: string }>()).results.map((row) => [
      row.key,
      row.fingerprint,
    ]),
  )

/** "bank" and "shore" linked by a synonym; "bank" with a plural form and a topic tag; all published. */
async function seed() {
  const token = await issueAgentKey()
  const bank = await headword('bank', [{ pos: 'noun', gloss: 'Land beside a river.' }])
  const shore = await headword('shore', [{ pos: 'noun', gloss: 'Land along water.' }])
  const [river] = bank.senses
  await submitOk(token, 'form', bank.entryId, { form: 'banks', type: 'plural' })
  await submitOk(token, 'topic', river as string, { topic_id: 'family-and-relationships' })
  await submitOk(token, 'relation', river as string, { type: 'synonym', target_sense_id: shore.senses[0] })
  stubReviewers()
  await deliverPendingReviews()
  return { token, bank, shore, river: river as string }
}

const read = async (paths: string[]) => Promise.all(paths.map(async (path) => call(path)))

describe('public replica', () => {
  it('serves the pushed entries as the source did, with no facts, across scheduled work, and no feedback [spec: replica/serve]', async () => {
    const { bank, river } = await seed()
    const paths = [
      '/v1/entries/bank',
      '/v1/entries/shore?lang=zh&include=review',
      `/v1/senses/${river}`,
      '/v1/forms/banks',
      '/v1/entries',
      '/v1/topics/family-and-relationships/senses',
      '/v1/search?q=river',
      `/v1/senses/${river}/members`,
    ]
    const before = await read(paths)
    expect(before.slice(0, 7).map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200, 200])
    const { plan, statements } = await syncFromSource(new Map())
    expect(plan).toMatchObject({ remove: [], unchanged: 0 })
    expect(plan.push).toHaveLength(3)

    await emptyReplica()
    await apply(statements)

    expect((await env.DB.prepare('SELECT count(*) AS n FROM facts').first<{ n: number }>())?.n).toBe(0)
    expect(await read(paths)).toEqual(before)
    await handleScheduled(env)
    expect(await read(paths)).toEqual(before)
    const feedback = await call('/v1/feedback', {
      method: 'POST',
      json: { target_type: 'entry', target_id: bank.entryId, message: 'Something is wrong here.' },
    })
    expect(feedback.status).toBe(404)
  })

  it('updates a changed entry and removes one no longer public on a later sync [spec: replica/update]', async () => {
    const { token, bank, shore } = await seed()
    const first = await syncFromSource(new Map())
    await submitOk(token, 'form', bank.entryId, { form: 'bankes', type: 'variant' })
    await deliverPendingReviews()
    await call(`/manage/v1/facts/${shore.inventory.id}/retract`, { method: 'POST', token: await adminToken() })
    const changed = await read(['/v1/entries/bank', '/v1/forms/bankes', '/v1/entries/shore'])
    expect(changed.map((response) => response.status)).toEqual([200, 200, 404])
    const second = await syncFromSource(first.fingerprints)
    expect(second.plan.push).toEqual([`entry:${bank.entryId}`])
    expect(second.plan.remove).toEqual([`entry:${shore.entryId}`])

    await emptyReplica()
    await apply(first.statements)
    await apply(second.statements)

    expect(await read(['/v1/entries/bank', '/v1/forms/bankes', '/v1/entries/shore'])).toEqual(changed)
    expect(await replicaManifest()).toEqual(second.fingerprints)
  })

  it('pushes an entry whose view row is longer than one statement allows [spec: replica/long-row]', async () => {
    const { bank } = await seed()
    const unit = await source.unit(bank.entryId)
    const [row] = unit.rows.public_entries
    const document = JSON.parse(String(row?.document))
    // Quotes, multi-byte text, and an astral character, so the parts split on code points and escape.
    document.padding = "it's 词典 🍎 ".repeat(12_000)
    const long = { ...row, document: JSON.stringify(document) }
    expect(new TextEncoder().encode(long.document).length).toBeGreaterThan(200_000)
    const statements = pushEntrySql(
      { ...unit, rows: { ...unit.rows, public_entries: [long] } },
      'f',
      '2026-11-19T00:00:00.000Z',
    )
    expect(Math.max(...statements.map((statement) => new TextEncoder().encode(statement).length))).toBeLessThan(100_000)

    await emptyReplica()
    await apply(statements)

    const stored = await env.DB.prepare('SELECT document FROM public_entries WHERE entry_id = ?')
      .bind(bank.entryId)
      .first()
    expect(stored?.document).toBe(long.document)
    expect((await call('/v1/entries/bank')).status).toBe(200)
  })
})
