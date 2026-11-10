import { env } from 'cloudflare:test'
import { createDeps } from '@server/composition'
import type { SenseId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { call, issueAgentKey } from './helpers'

const review = JSON.stringify({
  reviewer: 'llm',
  model: 'm',
  verdict: 'fail',
  confidence: 0.9,
  reason: 'Too general.',
  context: {},
  detail: {},
  reviewed_at: '2026-01-01T00:00:00.000Z',
})

interface Row {
  kind: string
  subject: string
  object?: string
  key: string
  status: string
  at: string
}

const payloads: Record<string, (row: Row) => unknown> = {
  topic: ({ key }) => ({ topic_id: key }),
  relation: ({ object }) => ({ type: 'synonym', target_sense_id: object }),
  example: ({ key }) => ({ text: key }),
}

async function insertFact(row: Row): Promise<string> {
  const { kind, subject, object, key, status, at } = row
  const id = crypto.randomUUID()
  await env.DB.prepare(
    `insert into facts (id, kind, subject_id, object_id, content_key, payload, status, exclusive, author, review, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, 0, 'agent:test', ?, ?, ?)`,
  )
    .bind(id, kind, subject, object ?? null, key, JSON.stringify(payloads[kind]?.(row)), status, review, at, at)
    .run()
  return id
}

describe('rejected attempts', () => {
  it('lists the latest rejected facts of the filling kinds about a node [spec: facts/rejected-attempts-query]', async () => {
    const node = crypto.randomUUID() as SenseId
    const other = crypto.randomUUID()
    const at = (minute: number) => `2026-01-01T00:0${minute}:00.000Z`
    const oldest = await insertFact({ kind: 'topic', subject: node, key: 'a', status: 'rejected', at: at(1) })
    const incoming = await insertFact({
      kind: 'relation',
      subject: other,
      object: node,
      key: 'r',
      status: 'rejected',
      at: at(2),
    })
    const latest = await insertFact({ kind: 'topic', subject: node, key: 'b', status: 'rejected', at: at(3) })
    await insertFact({ kind: 'topic', subject: node, key: 'c', status: 'rejected', at: at(4) })
    await insertFact({ kind: 'topic', subject: node, key: 'c', status: 'published', at: at(5) })
    await insertFact({ kind: 'topic', subject: node, key: 'd', status: 'retracted', at: at(6) })
    await insertFact({ kind: 'example', subject: node, key: 'e', status: 'rejected', at: at(7) })
    await insertFact({ kind: 'topic', subject: other, key: 'f', status: 'rejected', at: at(8) })

    const { facts } = createDeps(env)
    const ids = async (kinds: Parameters<typeof facts.listRejected>[1], limit: number) =>
      (await facts.listRejected(node, kinds, limit)).map((fact) => fact.id)

    expect(await ids(['topic', 'relation'], 10)).toEqual([latest, incoming, oldest])
    expect(await ids(['topic'], 1)).toEqual([latest])
    expect((await facts.listRejected(node, ['topic'], 1))[0]).toMatchObject({
      kind: 'topic',
      status: 'rejected',
      review: { reason: 'Too general.' },
    })
  })
})

describe('rejected derivations', () => {
  it('lists the latest rejected word formations of other entries built on a lemma [spec: facts/rejected-derivations-query]', async () => {
    const suffix = crypto.randomUUID().slice(0, 8)
    const base = `pray${suffix}`
    const entry = async (lemma: string) => {
      const id = crypto.randomUUID()
      await env.DB.prepare(
        `insert into entries (id, lemma, created_by, created_at) values (?, ?, 'agent:test', '2026-01-01T00:00:00.000Z')`,
      )
        .bind(id, lemma)
        .run()
      return id
    }
    const formation = async (subject: string, parts: unknown[], key: string, status: string, minute: number) => {
      const id = crypto.randomUUID()
      const at = `2026-01-01T00:0${minute}:00.000Z`
      await env.DB.prepare(
        `insert into facts (id, kind, subject_id, object_id, content_key, payload, status, exclusive, author, review, created_at, updated_at)
         values (?, 'morphology', ?, null, ?, ?, ?, 1, 'agent:test', ?, ?, ?)`,
      )
        .bind(id, subject, key, JSON.stringify({ parts }), status, review, at, at)
        .run()
      return id
    }
    const on = (lemma: string, suffixForm: string) => [
      { form: lemma, role: 'base', lemma },
      { form: suffixForm, role: 'suffix' },
    ]
    const prayer = await entry(`${base}er`)
    const praying = await entry(`${base}ing`)
    const other = await entry(`other${suffix}`)
    const oldest = await formation(prayer, on(base, '-er'), 'a', 'rejected', 1)
    const latest = await formation(praying, on(base, '-ing'), 'b', 'rejected', 2)
    await formation(praying, on(base, '-s'), 'c', 'rejected', 3)
    await formation(praying, on(base, '-s'), 'c', 'pending', 4)
    await formation(prayer, on(base, '-ful'), 'd', 'published', 5)
    await formation(other, on(`${base}x`, '-er'), 'e', 'rejected', 6)
    await formation(other, [{ form: base, role: 'base' }], 'f', 'rejected', 7)

    const { facts } = createDeps(env)
    const listed = await facts.listRejectedDerivations(base, 10)
    expect(listed.map(({ word, fact }) => [word, fact.id])).toEqual([
      [`${base}ing`, latest],
      [`${base}er`, oldest],
    ])
    expect(listed[0]?.fact).toMatchObject({
      kind: 'morphology',
      status: 'rejected',
      review: { reason: 'Too general.' },
    })
    expect((await facts.listRejectedDerivations(base, 1)).map(({ fact }) => fact.id)).toEqual([latest])
  })
})

describe('closure attempts release', () => {
  it('lifts every stall and makes every worklist row stale [spec: work/closure-attempts-unstall-migration]', async () => {
    const token = await issueAgentKey()
    for (const lemma of ['body', 'care']) {
      await call('/manage/v1/entries', { method: 'POST', token, json: { lemma } })
    }
    await env.DB.prepare(
      `update worklist set scored_revision = revision, stalled = 1, claimed_work = '{"gaps":[]}'`,
    ).run()

    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name.endsWith('_closure_attempts_unstall.sql'))
    if (!migration) throw new Error('The closure_attempts_unstall migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()

    const rows = await env.DB.prepare(
      'select count(*) as n, sum(stalled) as stalled, sum(claimed_work is not null) as claimed, sum(revision = scored_revision) as fresh from worklist',
    ).first()
    expect(rows).toMatchObject({ stalled: 0, claimed: 0, fresh: 0 })
    expect(rows?.n).toBeGreaterThanOrEqual(2)
  })
})
