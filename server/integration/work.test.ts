import { env } from 'cloudflare:test'
import { createEntryResultSchema, managedEntrySchema } from '@shared/catalog'
import { apiErrorSchema } from '@shared/types'
import { workClaimSchema, workCompletionSchema } from '@shared/work'
import { describe, expect, it } from 'vitest'
import { adminToken, call, issueAgentKey } from './helpers'

const createEntry = async (token: string, lemma: string) =>
  createEntryResultSchema.parse((await call('/manage/v1/entries', { method: 'POST', token, json: { lemma } })).body)

const claim = (token: string, json?: unknown) => call('/manage/v1/work/claim', { method: 'POST', token, json })
const complete = (token: string, leaseId: string, json?: unknown) =>
  call(`/manage/v1/work/${leaseId}/complete`, { method: 'POST', token, json })
const codeOf = (body: unknown) => apiErrorSchema.parse(body).error.code

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
    await env.DB.prepare('update work_leases set expires_at = ?')
      .bind(new Date(Date.now() - 1000).toISOString())
      .run()

    const late = await complete(first, lapsed.lease.id)
    expect([late.status, codeOf(late.body)]).toEqual([409, 'conflict'])
    const taken = workClaimSchema.parse((await claim(second)).body)
    expect(taken.lease).toMatchObject({ entry_id: entry.id })
    expect(taken.lease.id).not.toBe(lapsed.lease.id)
    expect((await complete(second, taken.lease.id)).status).toBe(200)
  })
})
