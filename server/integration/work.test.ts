import { env } from 'cloudflare:test'
import { claimStatement } from '@server/adapters/repos/work'
import { createDb } from '@server/db/client'
import type { PrincipalRef } from '@server/domain/principal'
import { createEntryResultSchema, managedEntrySchema } from '@shared/catalog'
import { apiErrorSchema } from '@shared/types'
import { type WorkLeaseId, workClaimSchema, workCompletionSchema } from '@shared/work'
import { describe, expect, it } from 'vitest'
import { adminToken, call, issueAgentKey } from './helpers'

const postEntry = (token: string, json: { lemma: string; seed?: boolean }) =>
  call('/manage/v1/entries', { method: 'POST', token, json })
const createEntry = async (token: string, lemma: string) =>
  createEntryResultSchema.parse((await postEntry(token, { lemma })).body)

const claim = (token: string, json?: unknown) => call('/manage/v1/work/claim', { method: 'POST', token, json })
const complete = (token: string, leaseId: string, json?: unknown) =>
  call(`/manage/v1/work/${leaseId}/complete`, { method: 'POST', token, json })
const codeOf = (body: unknown) => apiErrorSchema.parse(body).error.code
const lemmaOf = async (token: string) => {
  const result = await claim(token)
  return result.status === 204 ? null : workClaimSchema.parse(result.body).lease.lemma
}
const expireLeases = () =>
  env.DB.prepare('update worklist set lease_expires_at = ? where lease_id is not null')
    .bind(new Date(Date.now() - 1000).toISOString())
    .run()

describe('worklist', () => {
  it('claims an entry with its gaps and completes it [spec: work/claim-api]', async () => {
    const holder = await issueAgentKey('holder')
    const other = await issueAgentKey('other')
    const { entry } = await createEntry(holder, 'tide')
    expect((await call('/manage/v1/work/claim', { method: 'POST' })).status).toBe(401)

    const claimed = await claim(holder, { lease_seconds: 600 })
    expect(claimed.status).toBe(200)
    const work = workClaimSchema.parse(claimed.body)
    expect(work.lease).toMatchObject({ entry_id: entry.id, lemma: 'tide', holder: expect.stringMatching(/^agent:/) })
    expect(Date.parse(work.lease.expires_at) - Date.now()).toBeGreaterThan(590_000)
    const view = managedEntrySchema.parse((await call('/manage/v1/entries/tide', { token: holder })).body)
    expect(work.entry).toEqual(view)
    expect(work.gaps).toEqual([{ type: 'senses' }, { type: 'forms' }, { type: 'pronunciation' }])

    expect((await claim(other)).status).toBe(204)
    const stolen = await complete(other, work.lease.id)
    expect([stolen.status, codeOf(stolen.body)]).toEqual([409, 'conflict'])

    const done = await complete(holder, work.lease.id, { note: 'Needs senses.' })
    expect(done.status).toBe(200)
    expect(workCompletionSchema.parse(done.body).entry_id).toBe(entry.id)
    const again = await complete(holder, work.lease.id)
    expect([again.status, codeOf(again.body)]).toEqual([404, 'not_found'])

    const byAdmin = workClaimSchema.parse((await claim(await adminToken())).body)
    expect(byAdmin.lease).toMatchObject({ entry_id: entry.id, holder: 'admin:admin-1' })
  })

  it('rejects a lease_seconds outside 60..3600', async () => {
    const token = await issueAgentKey()
    const tooShort = await claim(token, { lease_seconds: 59 })
    expect([tooShort.status, codeOf(tooShort.body)]).toEqual([400, 'invalid_request'])
  })

  it('gives concurrent claims distinct entries [spec: work/claim-race]', async () => {
    const tokens = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((name) => issueAgentKey(name)))
    const lemmas = ['bay', 'cove', 'fjord']
    for (const lemma of lemmas) await createEntry(tokens[0], lemma)

    const results = await Promise.all(tokens.map((token) => claim(token)))
    const won = results.filter((result) => result.status === 200).map((result) => workClaimSchema.parse(result.body))
    expect(won.map((work) => work.lease.lemma).sort()).toEqual(lemmas)
    expect(results.filter((result) => result.status === 204)).toHaveLength(2)
  })

  it('lets another agent claim an expired lease, which its holder can no longer complete [spec: work/lease-expiry-api]', async () => {
    const first = await issueAgentKey('first')
    const second = await issueAgentKey('second')
    const { entry } = await createEntry(first, 'tide')
    const lapsed = workClaimSchema.parse((await claim(first)).body)
    await expireLeases()

    const late = await complete(first, lapsed.lease.id)
    expect([late.status, codeOf(late.body)]).toEqual([409, 'conflict'])
    const taken = workClaimSchema.parse((await claim(second)).body)
    expect(taken.lease).toMatchObject({ entry_id: entry.id })
    expect(taken.lease.id).not.toBe(lapsed.lease.id)
    expect((await complete(second, taken.lease.id)).status).toBe(200)
  })

  it('claims an entry worked once before never-claimed entries, and a second time after them [spec: work/claim-second-pass]', async () => {
    const token = await issueAgentKey()
    const bay = await createEntry(token, 'bay')
    for (const lemma of ['cove', 'fjord']) await createEntry(token, lemma)
    const first = workClaimSchema.parse((await claim(token)).body)
    expect(first.lease.lemma).toBe('bay')
    const sense = await call('/manage/v1/senses', {
      method: 'POST',
      token,
      json: { entry_id: bay.entry.id, pos: 'noun', gloss: 'A broad inlet of the sea.' },
    })
    expect(sense.status).toBe(201)
    expect((await complete(token, first.lease.id)).status).toBe(200)

    const second = workClaimSchema.parse((await claim(token)).body)
    expect(second.lease.lemma).toBe('bay')
    expect(second.gaps.map((gap) => gap.type)).toEqual([
      'forms',
      'pronunciation',
      'relations',
      'examples',
      'translations',
    ])
    expect((await complete(token, second.lease.id)).status).toBe(200)

    expect(await lemmaOf(token)).toBe('cove')
    expect(await lemmaOf(token)).toBe('fjord')
    expect(await lemmaOf(token)).toBe('bay')
  })

  it('claims never-claimed seed entries before other never-claimed entries, each after its second pass [spec: work/claim-seeds-first]', async () => {
    const token = await issueAgentKey()
    for (const lemma of ['bay', 'cove']) await createEntry(token, lemma)
    expect((await postEntry(token, { lemma: 'fjord', seed: true })).status).toBe(201)
    const marked = await postEntry(token, { lemma: 'cove', seed: true })
    expect(marked.status).toBe(200)
    expect(createEntryResultSchema.parse(marked.body)).toMatchObject({ created: false, entry: { lemma: 'cove' } })
    expect((await postEntry(token, { lemma: 'fjord', seed: false })).status).toBe(200)

    const order = []
    for (let pass = 0; pass < 5; pass++) {
      const work = workClaimSchema.parse((await claim(token)).body)
      expect((await complete(token, work.lease.id)).status).toBe(200)
      order.push(work.lease.lemma)
    }
    expect(order).toEqual(['cove', 'cove', 'fjord', 'fjord', 'bay'])
  })

  it('says in the entry view and the claim whether an entry is a seed entry [spec: work/entry-seed]', async () => {
    const token = await issueAgentKey()
    await postEntry(token, { lemma: 'cove', seed: true })
    await createEntry(token, 'bay')
    const seedOf = async (lemma: string) =>
      managedEntrySchema.parse((await call(`/manage/v1/entries/${lemma}`, { token })).body).seed
    expect([await seedOf('cove'), await seedOf('bay')]).toEqual([true, false])
    const claims = [workClaimSchema.parse((await claim(token)).body), workClaimSchema.parse((await claim(token)).body)]
    expect(claims.map((work) => [work.lease.lemma, work.entry.seed])).toEqual([
      ['cove', true],
      ['bay', false],
    ])
  })

  it('moves an entry whose lease lapsed twice behind the entries claimed fewer times [spec: work/claim-rotation]', async () => {
    const token = await issueAgentKey()
    for (const lemma of ['bay', 'cove', 'fjord']) await createEntry(token, lemma)
    expect(await lemmaOf(token)).toBe('bay')
    await expireLeases()
    expect(await lemmaOf(token)).toBe('bay')
    await expireLeases()

    expect(await lemmaOf(token)).toBe('cove')
    expect(await lemmaOf(token)).toBe('fjord')
    await expireLeases()
    expect(await lemmaOf(token)).toBe('cove')
    expect(await lemmaOf(token)).toBe('fjord')
    expect(await lemmaOf(token)).toBe('bay')
  })

  it('hands each expired lease to exactly one of the claims racing for it [spec: work/claim-expired-race]', async () => {
    const tokens = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((name) => issueAgentKey(name)))
    const lemmas = ['bay', 'cove', 'fjord']
    for (const lemma of lemmas) await createEntry(tokens[0], lemma)
    for (const token of tokens.slice(0, 3)) expect((await claim(token)).status).toBe(200)
    expect((await claim(tokens[3])).status).toBe(204)
    await expireLeases()

    const results = await Promise.all(tokens.map((token) => claim(token)))
    const won = results.filter((result) => result.status === 200).map((result) => workClaimSchema.parse(result.body))
    expect(won.map((work) => work.lease.lemma).sort()).toEqual(lemmas)
    expect(new Set(won.map((work) => work.lease.holder)).size).toBe(3)
    expect(results.filter((result) => result.status === 204)).toHaveLength(3)
  })

  it('serves an entry only while its entry fact is live [spec: work/claim-live]', async () => {
    const admin = await adminToken()
    const { fact } = await createEntry(admin, 'tide')
    const retracted = await call(`/manage/v1/facts/${fact.id}/retract`, { method: 'POST', token: admin })
    expect(retracted.status).toBe(200)
    expect(await lemmaOf(admin)).toBeNull()

    await createEntry(admin, 'tide')
    expect(await lemmaOf(admin)).toBe('tide')
  })

  it('reads the claim order from an index, without sorting the worklist [spec: work/claim-index]', async () => {
    const lease = {
      id: '00000000-0000-4000-8000-000000000001' as WorkLeaseId,
      holder: 'agent:a' as PrincipalRef,
      expiresAt: new Date().toISOString(),
    }
    const { sql, params } = claimStatement(createDb(env), lease, new Date().toISOString()).toSQL()
    const { results } = await env.DB.prepare(`explain query plan ${sql}`)
      .bind(...params)
      .all<{ detail: string }>()
    const plan = results.map((row) => row.detail)
    console.info(`claim query plan:\n${plan.join('\n')}`)
    expect(plan).toContain('SEARCH worklist USING INDEX worklist_claim_order_idx (live=?)')
    expect(plan.some((step) => step.includes('TEMP B-TREE'))).toBe(false)
  })
})
