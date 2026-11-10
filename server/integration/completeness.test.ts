import { env } from 'cloudflare:test'
import {
  createEntryResultSchema,
  createSenseResultSchema,
  managedEntrySchema,
  publicEntrySchema,
} from '@shared/catalog'
import { factSchema, factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { workClaimSchema, workRescoreResultSchema } from '@shared/work'
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
const gapsOf = async (token: string) =>
  workClaimSchema.parse((await call('/manage/v1/work/claim', { method: 'POST', token })).body)
const factOf = async (id: string) =>
  factSchema.parse((await call(`/manage/v1/facts/${id}`, { token: await adminToken() })).body)
const errorOf = (body: unknown) => apiErrorSchema.parse(body).error

describe('completeness', () => {
  afterEach(() => vi.restoreAllMocks())

  it('drains stale scores through the admin rescore [spec: work/rescore-api]', async () => {
    const token = await issueAgentKey()
    for (const lemma of ['tide', 'reef', 'cove']) await createEntry(token, lemma)
    await settle()
    await env.DB.prepare('update worklist set revision = revision + 1').run()
    const rescore = (json: unknown, as = token) => call('/manage/v1/work/rescore', { method: 'POST', token: as, json })
    expect((await rescore({ limit: 2 })).status).toBe(403)
    const admin = await adminToken()
    expect((await rescore({ limit: 0 }, admin)).status).toBe(400)
    expect(workRescoreResultSchema.parse((await rescore({ limit: 2 }, admin)).body)).toEqual({
      rescored: 2,
      remaining: 1,
    })
    expect(workRescoreResultSchema.parse((await rescore({}, admin)).body)).toEqual({ rescored: 1, remaining: 0 })
    const stale = await env.DB.prepare('select count(*) as n from worklist where revision <> scored_revision').first()
    expect(stale).toEqual({ n: 0 })
  })

  it('closes a gap with a reviewed closure that the public entry shows in its review metadata [spec: facts/gap-closure-api]', async () => {
    const token = await issueAgentKey()
    const { entry } = await createEntry(token, 'May')
    const { sense } = await createSense(token, {
      entry_id: entry.id,
      pos: 'noun',
      gloss: 'The fifth month of the year.',
      region: 'british',
    })
    await settle()
    const before = await gapsOf(token)
    expect(before.gaps).toContainEqual({ type: 'collocations', sense_id: sense.id })
    const onEntry = await submit(token, {
      kind: 'gap_closure',
      subject_id: entry.id,
      payload: { gap: 'collocations', reason: 'A month name has no common collocations.' },
    })
    expect([onEntry.status, errorOf(onEntry.body).code]).toEqual([422, 'invalid_reference'])
    const closure = await submitFact(token, {
      kind: 'gap_closure',
      subject_id: sense.id,
      payload: { gap: 'collocations', reason: 'A month name has no common collocations.' },
    })
    await call(`/manage/v1/work/${before.lease.id}/complete`, { method: 'POST', token })
    await settle()
    expect(await factOf(closure.id)).toMatchObject({ status: 'published', review: { reviewer: 'llm' } })
    const after = managedEntrySchema.parse((await call('/manage/v1/entries/May', { token })).body)
    expect(after.completeness).toBeGreaterThan(before.entry.completeness)
    expect((await gapsOf(token)).gaps).not.toContainEqual({ type: 'collocations', sense_id: sense.id })
    const view = publicEntrySchema.parse((await call('/v1/entries/May?include=review')).body)
    expect(view.review?.closures).toEqual([
      {
        gap: 'collocations',
        sense_id: sense.id,
        reason: 'A month name has no common collocations.',
        fact_id: closure.id,
        confidence: 0.88,
        verdict: 'pass',
      },
    ])
    expect(view.meanings[0]?.senses[0]?.region).toBe('british')
    const plain = publicEntrySchema.parse((await call('/v1/entries/May')).body)
    expect(plain.review).toBeUndefined()
  })

  it('opens a phrases gap on an A1 verb that a live phrase entry closes in the same request [spec: work/phrases-api]', async () => {
    const token = await issueAgentKey()
    await importLearnerData({ levels: { give: 'A1' } })
    const { entry } = await createEntry(token, 'give')
    await createSense(token, { entry_id: entry.id, pos: 'verb', gloss: 'To hand something to someone.' })
    await settle()
    const claim = await gapsOf(token)
    expect(claim.gaps).toContainEqual({ type: 'phrases' })
    await call(`/manage/v1/work/${claim.lease.id}/complete`, { method: 'POST', token })
    const row = () =>
      env.DB.prepare('select revision = scored_revision as fresh, completeness from worklist where entry_id = ?')
        .bind(entry.id)
        .first<{ fresh: number; completeness: number }>()
    const open = await row()
    await createEntry(token, 'give up')
    const closed = await row()
    expect(closed?.fresh).toBe(1)
    expect(closed?.completeness).toBeGreaterThan(open?.completeness ?? 1)
  })

  it('refuses periphrastic comparisons, non-house IPA, ASCII zh punctuation, and links to rare or dated senses [spec: facts/completeness-write-rules-api]', async () => {
    const token = await issueAgentKey()
    const { entry } = await createEntry(token, 'careful')
    const { sense } = await createSense(token, { entry_id: entry.id, pos: 'adjective', gloss: 'Taking care.' })
    const periphrastic = await submit(token, {
      kind: 'form',
      subject_id: entry.id,
      payload: { form: 'more careful', type: 'comparative' },
    })
    expect([periphrastic.status, errorOf(periphrastic.body).message]).toEqual([
      422,
      expect.stringContaining('"more careful" is a periphrastic comparative form'),
    ])
    const dotted = await submit(token, {
      kind: 'pronunciation',
      subject_id: entry.id,
      payload: { ipa: 'ˈkɛr.fəl', accent: 'us' },
    })
    expect(dotted.status).toBe(400)
    expect(JSON.stringify(dotted.body)).toContain('no syllable dots')
    expect(JSON.stringify(dotted.body)).toContain('An American ipa writes the vowel of')
    const ascii = await submit(token, {
      kind: 'translation',
      subject_id: sense.id,
      payload: { language: 'zh', text: '小心的;仔细的' },
    })
    expect(ascii.status).toBe(400)
    const { entry: wary } = await createEntry(token, 'wary')
    const { sense: old } = await createSense(token, {
      entry_id: wary.id,
      pos: 'adjective',
      gloss: 'Cautious about possible dangers.',
      register: 'dated',
    })
    const synonym = await submit(token, {
      kind: 'relation',
      subject_id: sense.id,
      payload: { type: 'synonym', target_sense_id: old.id },
    })
    expect([synonym.status, errorOf(synonym.body).message]).toEqual([
      422,
      `Sense ${old.id} is labelled dated; a relation links only current senses. Relate a current sense of the word instead.`,
    ])
  })

  it('brings stored facts to the new rules and leaves every row stale [spec: work/completeness-migration]', async () => {
    const token = await issueAgentKey()
    const { entry } = await createEntry(token, 'answer')
    const { sense, fact: gloss } = await createSense(token, {
      entry_id: entry.id,
      pos: 'noun',
      gloss: 'A reply to a question.',
    })
    const { sense: gone, fact: goneGloss } = await createSense(token, {
      entry_id: entry.id,
      pos: 'verb',
      gloss: 'To reply to someone.',
    })
    const { entry: reply } = await createEntry(token, 'reply')
    const { sense: replySense } = await createSense(token, { entry_id: reply.id, pos: 'verb', gloss: 'To answer.' })
    const pronounce = (ipa: string, accent: 'us' | 'uk') =>
      submitFact(token, { kind: 'pronunciation', subject_id: entry.id, payload: { ipa, accent } })
    const house = await pronounce('ˈænsər', 'us')
    const doubled = await pronounce('ˈænsəɹ', 'us').catch(() => null)
    expect(doubled).toBeNull()
    const legacyUs = await pronounce('ˈænsə', 'us')
    const legacyUk = await pronounce('ˈɑːnsə', 'uk')
    const legacyCare = await pronounce('ker', 'us')
    const past = await submitFact(token, {
      kind: 'form',
      subject_id: entry.id,
      payload: { form: 'answered', type: 'past', ipa: 'ˈænsərd', accent: 'us' },
    })
    const comparative = await submitFact(token, {
      kind: 'form',
      subject_id: entry.id,
      payload: { form: 'answerer', type: 'comparative' },
    })
    const repeated = await submitFact(token, {
      kind: 'translation',
      subject_id: sense.id,
      payload: { language: 'zh', text: '回答；答复' },
    })
    const kept = await submitFact(token, {
      kind: 'translation',
      subject_id: sense.id,
      payload: { language: 'zh', text: '答案' },
    })
    const clash = await submitFact(token, {
      kind: 'translation',
      subject_id: sense.id,
      payload: { language: 'zh', text: '答案；回复' },
    })
    const orphanExample = await submitFact(token, {
      kind: 'example',
      subject_id: gone.id,
      payload: { text: 'Answer me.' },
    })
    const orphanLink = await submitFact(token, {
      kind: 'relation',
      subject_id: replySense.id,
      payload: { type: 'synonym', target_sense_id: gone.id },
    })
    const list = await submitFact(token, {
      kind: 'sense_list',
      subject_id: entry.id,
      payload: { common: [sense.id, gone.id], extra: [] },
    })
    await settle()
    expect((await call(`/manage/v1/facts/${goneGloss.id}/retract`, { method: 'POST', token })).status).toBe(200)
    // Rows as the old rules stored them.
    const legacy = (id: string, payload: unknown, key: string) =>
      env.DB.prepare('update facts set payload = ?, content_key = ? where id = ?')
        .bind(JSON.stringify(payload), key, id)
        .run()
    await legacy(legacyUs.id, { ipa: 'ˈæn.sɚ', accent: 'us' }, 'us|ˈæn.sɚ')
    await legacy(legacyUk.id, { ipa: 'ˈɑːn.sə', accent: 'uk' }, 'uk|ˈɑːn.sə')
    await legacy(legacyCare.id, { ipa: 'kɛr', accent: 'us' }, 'us|kɛr')
    await legacy(past.id, { form: 'answered', type: 'past', ipa: 'ˈæn.sɚd', accent: 'us' }, 'past|answered|us:ˈæn.sɚd')
    await legacy(comparative.id, { form: 'more answer', type: 'comparative' }, 'comparative|more answer')
    await legacy(repeated.id, { language: 'zh', text: '回答;答复；回答' }, 'zh|回答;答复；回答')
    await legacy(clash.id, { language: 'zh', text: '答案；答案' }, 'zh|答案；答案')
    await env.DB.prepare("update facts set review = json_set(review, '$.verdict', 'uncertain') where id = ?")
      .bind(list.id)
      .run()
    await env.DB.prepare('update worklist set scored_revision = revision').run()

    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name.endsWith('_completeness_rules.sql'))
    if (!migration) throw new Error('The completeness_rules migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()

    const facts = await Promise.all(
      [
        house,
        legacyUs,
        legacyUk,
        legacyCare,
        past,
        comparative,
        repeated,
        kept,
        clash,
        orphanExample,
        orphanLink,
        list,
        gloss,
      ].map((fact) => factOf(fact.id)),
    )
    const [
      houseNow,
      usNow,
      ukNow,
      careNow,
      pastNow,
      comparativeNow,
      repeatedNow,
      keptNow,
      clashNow,
      exampleNow,
      linkNow,
      listNow,
      glossNow,
    ] = facts
    expect(houseNow).toMatchObject({ status: 'published', payload: { ipa: 'ˈænsər' } })
    expect(usNow.status).toBe('retracted')
    expect(ukNow).toMatchObject({ status: 'published', payload: { ipa: 'ˈɑːnsə', accent: 'uk' } })
    expect(careNow).toMatchObject({ status: 'published', payload: { ipa: 'ker' } })
    expect(pastNow).toMatchObject({ status: 'published', payload: { ipa: 'ˈænsərd' } })
    expect(comparativeNow.status).toBe('retracted')
    expect(repeatedNow).toMatchObject({ status: 'published', payload: { text: '回答；答复' } })
    expect(keptNow).toMatchObject({ status: 'published', payload: { text: '答案' } })
    expect(clashNow.status).toBe('retracted')
    expect(exampleNow.status).toBe('retracted')
    expect(linkNow.status).toBe('retracted')
    expect(glossNow.status).toBe('published')
    expect(listNow).toMatchObject({ status: 'published' })
    // Keys match what the registry computes, so a resubmission finds the rewritten facts.
    const again = await submit(token, {
      kind: 'pronunciation',
      subject_id: entry.id,
      payload: { ipa: 'ˈɑːnsə', accent: 'uk' },
    })
    expect(factWriteResultSchema.parse(again.body)).toMatchObject({ created: false, fact: { id: legacyUk.id } })
    const zhAgain = await submit(token, {
      kind: 'translation',
      subject_id: sense.id,
      payload: { language: 'zh', text: '回答；答复' },
    })
    expect(factWriteResultSchema.parse(zhAgain.body)).toMatchObject({ created: false, fact: { id: repeated.id } })
    const marks = await env.DB.prepare('select revalidate_since is not null as marked from facts where id = ?')
      .bind(list.id)
      .first()
    expect(marks).toEqual({ marked: 1 })
    const stale = await env.DB.prepare('select count(*) as n from worklist where revision = scored_revision').first()
    expect(stale).toEqual({ n: 0 })
  })
})
