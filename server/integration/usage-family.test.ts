import { env } from 'cloudflare:test'
import { createEntryResultSchema, createSenseResultSchema, publicEntrySchema } from '@shared/catalog'
import { factSchema, factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { workClaimSchema } from '@shared/work'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminToken, call, deliverPendingReviews, importLearnerData, issueAgentKey, stubReviewers } from './helpers'

const createEntry = async (token: string, lemma: string) =>
  createEntryResultSchema.parse((await call('/manage/v1/entries', { method: 'POST', token, json: { lemma } })).body)
const createSense = async (token: string, json: Record<string, unknown>) =>
  createSenseResultSchema.parse((await call('/manage/v1/senses', { method: 'POST', token, json })).body)
const submit = (token: string, json: unknown) => call('/manage/v1/facts', { method: 'POST', token, json })
const submitFact = async (token: string, json: unknown) => {
  const result = await submit(token, json)
  if (result.status !== 201) throw new Error(`Submission failed: ${JSON.stringify(result.body)}`)
  return factWriteResultSchema.parse(result.body).fact
}
const settle = async () => {
  const reviewers = stubReviewers()
  await deliverPendingReviews()
  reviewers.mockRestore()
}
const factOf = async (id: string) =>
  factSchema.parse((await call(`/manage/v1/facts/${id}`, { token: await adminToken() })).body)
const errorOf = (body: unknown) => apiErrorSchema.parse(body).error
const rowOf = (entryId: string) =>
  env.DB.prepare('select revision = scored_revision as fresh, completeness from worklist where entry_id = ?')
    .bind(entryId)
    .first<{ fresh: number; completeness: number }>()

describe('usage and word family completeness', () => {
  afterEach(() => vi.restoreAllMocks())

  it('opens a family gap on an A1 word that a derivative naming it as a base fills in the same request [spec: work/family-api]', async () => {
    const token = await issueAgentKey()
    await importLearnerData({ levels: { happy: 'A1' } })
    const { entry: happy } = await createEntry(token, 'happy')
    await createSense(token, { entry_id: happy.id, pos: 'adjective', gloss: 'Feeling pleasure.' })
    await settle()
    const claim = workClaimSchema.parse((await call('/manage/v1/work/claim', { method: 'POST', token })).body)
    expect(claim.gaps).toContainEqual({ type: 'family' })
    await call(`/manage/v1/work/${claim.lease.id}/complete`, { method: 'POST', token })
    const open = await rowOf(happy.id)
    const { entry: happiness } = await createEntry(token, 'happiness')
    const parts = [
      { form: 'happy', role: 'base', lemma: 'happy' },
      { form: '-ness', role: 'suffix' },
    ]
    const unknown = await submit(token, {
      kind: 'morphology',
      subject_id: happiness.id,
      payload: { parts: [{ form: 'happy', role: 'base', lemma: 'Happy' }, parts[1]] },
    })
    expect([unknown.status, errorOf(unknown.body).message]).toEqual([
      422,
      '"Happy" is not the lemma of a live entry; a base names an entry exactly as it is spelled. Create that entry first, or leave the lemma out.',
    ])
    const misplaced = await submit(token, {
      kind: 'morphology',
      subject_id: happiness.id,
      payload: { parts: [parts[0], { form: '-ness', role: 'suffix', lemma: 'happy' }] },
    })
    expect(misplaced.status).toBe(400)
    const formation = await submitFact(token, { kind: 'morphology', subject_id: happiness.id, payload: { parts } })
    const filled = await rowOf(happy.id)
    expect(filled?.fresh).toBe(1)
    expect(filled?.completeness).toBeGreaterThan(open?.completeness ?? 1)
    await settle()
    const view = publicEntrySchema.parse((await call('/v1/entries/happiness')).body)
    expect(view.morphology?.parts[0]).toEqual({ form: 'happy', role: 'base', lemma: 'happy' })
    const base = publicEntrySchema.parse((await call('/v1/entries/happy')).body)
    expect(base.morphology).toBeNull()
    // Retracting the derivative's formation reopens the base's gap.
    expect((await call(`/manage/v1/facts/${formation.id}/retract`, { method: 'POST', token })).status).toBe(200)
    expect((await rowOf(happy.id))?.completeness).toBe(open?.completeness)
  })

  it('refuses a synonym between spellings of one word over HTTP [spec: facts/relation-padding-api]', async () => {
    const token = await issueAgentKey()
    const { entry: practise } = await createEntry(token, 'practise')
    const { sense: verb } = await createSense(token, { entry_id: practise.id, pos: 'verb', gloss: 'To do repeatedly.' })
    const { entry: practice } = await createEntry(token, 'practice')
    const { sense: usVerb } = await createSense(token, { entry_id: practice.id, pos: 'verb', gloss: 'To rehearse.' })
    await submitFact(token, { kind: 'form', subject_id: practise.id, payload: { form: 'practice', type: 'variant' } })
    const synonym = await submit(token, {
      kind: 'relation',
      subject_id: verb.id,
      payload: { type: 'synonym', target_sense_id: usVerb.id },
    })
    expect([synonym.status, errorOf(synonym.body).message]).toEqual([
      422,
      expect.stringContaining('are spellings of one word'),
    ])
  })

  it('brings stored facts to the usage and family rules and leaves every row stale [spec: work/usage-family-migration]', async () => {
    const token = await issueAgentKey()
    await importLearnerData({ levels: { happy: 'A1' } })
    const { entry: happy } = await createEntry(token, 'happy')
    const { sense: glad, fact: gloss } = await createSense(token, {
      entry_id: happy.id,
      pos: 'adjective',
      gloss: 'Feeling pleasure.',
    })
    const { sense: rare, fact: rareGloss } = await createSense(token, {
      entry_id: happy.id,
      pos: 'adjective',
      gloss: 'Inclined to use something too readily.',
    })
    const list = await submitFact(token, {
      kind: 'sense_list',
      subject_id: happy.id,
      payload: { common: [glad.id], extra: [rare.id] },
    })
    const closure = await submitFact(token, {
      kind: 'gap_closure',
      subject_id: happy.id,
      payload: { gap: 'phrases', reason: 'Happy is no verb.' },
    })
    const { entry: happiness } = await createEntry(token, 'happiness')
    const { sense: joy, fact: joyGloss } = await createSense(token, {
      entry_id: happiness.id,
      pos: 'noun',
      gloss: 'The state of being happy.',
    })
    const legacy = await submitFact(token, {
      kind: 'morphology',
      subject_id: happiness.id,
      payload: {
        parts: [
          { form: 'happy', role: 'base' },
          { form: '-ness', role: 'suffix', meaning: 'state' },
        ],
      },
    })
    const simple = await submitFact(token, {
      kind: 'morphology',
      subject_id: happy.id,
      payload: { parts: [{ form: 'happy', role: 'base' }] },
    })
    const { entry: practise } = await createEntry(token, 'practise')
    const { sense: drill } = await createSense(token, {
      entry_id: practise.id,
      pos: 'verb',
      gloss: 'To do repeatedly.',
    })
    const { entry: practice } = await createEntry(token, 'practice')
    const { sense: rehearse } = await createSense(token, { entry_id: practice.id, pos: 'verb', gloss: 'To rehearse.' })
    // Stored before the write rule: a synonym between a spelling and its main entry.
    const padded = await submitFact(token, {
      kind: 'relation',
      subject_id: drill.id,
      payload: { type: 'synonym', target_sense_id: rehearse.id },
    })
    await submitFact(token, { kind: 'form', subject_id: practise.id, payload: { form: 'practice', type: 'variant' } })
    const kept = await submitFact(token, {
      kind: 'relation',
      subject_id: glad.id,
      payload: { type: 'synonym', target_sense_id: joy.id },
    })
    await settle()
    await env.DB.prepare('update worklist set scored_revision = revision').run()

    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name.endsWith('_completeness_usage_family.sql'))
    if (!migration) throw new Error('The completeness_usage_family migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()

    expect(await factOf(legacy.id)).toMatchObject({
      status: 'published',
      payload: {
        parts: [
          { form: 'happy', role: 'base', lemma: 'happy' },
          { form: '-ness', role: 'suffix', meaning: 'state' },
        ],
      },
    })
    expect((await factOf(simple.id)).payload).toEqual({ parts: [{ form: 'happy', role: 'base' }] })
    // The rewritten key is the one the registry computes, so a resubmission finds the fact.
    const again = await submit(token, {
      kind: 'morphology',
      subject_id: happiness.id,
      payload: {
        parts: [
          { form: 'happy', role: 'base', lemma: 'happy' },
          { form: '-ness', role: 'suffix', meaning: 'state' },
        ],
      },
    })
    expect(factWriteResultSchema.parse(again.body)).toMatchObject({ created: false, fact: { id: legacy.id } })
    expect((await factOf(padded.id)).status).toBe('retracted')
    expect((await factOf(kept.id)).status).toBe('published')
    const marked = async (id: string) =>
      (
        await env.DB.prepare('select revalidate_since is not null as marked from facts where id = ?')
          .bind(id)
          .first<{ marked: number }>()
      )?.marked
    // A1 glosses of common senses, A1 sense lists, phrases closures, and formations of several parts.
    expect(await marked(gloss.id)).toBe(1)
    expect(await marked(rareGloss.id)).toBe(0)
    expect(await marked(joyGloss.id)).toBe(0)
    expect(await marked(list.id)).toBe(1)
    expect(await marked(closure.id)).toBe(1)
    expect(await marked(legacy.id)).toBe(1)
    expect(await marked(simple.id)).toBe(0)
    const stale = await env.DB.prepare('select count(*) as n from worklist where revision = scored_revision').first()
    expect(stale).toEqual({ n: 0 })
  })
})
