import { env } from 'cloudflare:test'
import { createEntryResultSchema, createSenseResultSchema } from '@shared/catalog'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminToken, call, deliverPendingReviews, importLearnerData, issueAgentKey, stubReviewers } from './helpers'

const createEntry = async (token: string, lemma: string) =>
  createEntryResultSchema.parse((await call('/manage/v1/entries', { method: 'POST', token, json: { lemma } })).body)
const createSense = async (token: string, json: Record<string, unknown>) =>
  createSenseResultSchema.parse((await call('/manage/v1/senses', { method: 'POST', token, json })).body)
const settle = async () => {
  const reviewers = stubReviewers()
  await deliverPendingReviews()
  reviewers.mockRestore()
}

describe('core verb phrases release', () => {
  afterEach(() => vi.restoreAllMocks())

  it('marks for review in place the entry facts of recent agent-created phrasal verbs headed by a verb [spec: work/core-verb-phrases-migration]', async () => {
    const token = await issueAgentKey()
    const admin = await adminToken()
    await importLearnerData({ levels: { 'give up': 'B1' } })
    const withSense = async (as: string, lemma: string, pos: string) => {
      const { entry } = await createEntry(as, lemma)
      await createSense(as, { entry_id: entry.id, pos, gloss: `A sense of ${lemma}.` })
      return entry
    }
    await withSense(token, 'telephone', 'verb')
    await withSense(token, 'desk', 'noun')
    const coined = await withSense(token, 'telephone in', 'verb')
    const earlier = await withSense(token, 'telephone back', 'verb')
    const notVerb = await withSense(token, 'telephone box', 'noun')
    const nounHead = await withSense(token, 'desk up', 'verb')
    await withSense(token, 'give', 'verb')
    const listed = await withSense(token, 'give up', 'verb')
    const byAdmin = await withSense(admin, 'telephone around', 'verb')
    await settle()
    await env.DB.prepare(`update entries set created_at = '2020-01-01T00:00:00.000Z' where id = ?`)
      .bind(earlier.id)
      .run()
    await env.DB.prepare('update worklist set scored_revision = revision').run()

    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name.endsWith('_core_verb_phrases.sql'))
    if (!migration) throw new Error('The core_verb_phrases migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()

    const marked = async (entryId: string) =>
      (
        await env.DB.prepare(
          `select revalidate_since is not null as marked from facts where kind = 'entry' and subject_id = ? and status = 'published'`,
        )
          .bind(entryId)
          .first<{ marked: number }>()
      )?.marked
    expect(await marked(coined.id)).toBe(1)
    for (const entry of [earlier, notVerb, nounHead, listed, byAdmin]) expect(await marked(entry.id)).toBe(0)
    const fresh = await env.DB.prepare('select count(*) as n from worklist where revision = scored_revision').first()
    expect(fresh).toEqual({ n: 0 })
  })
})
