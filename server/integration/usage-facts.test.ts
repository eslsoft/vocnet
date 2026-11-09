import {
  createEntryResultSchema,
  createSenseResultSchema,
  publicEntrySchema,
  publicSenseWithEntrySchema,
} from '@shared/catalog'
import { factSchema, factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { call, deliverPendingReviews, issueAgentKey, stubReviewers } from './helpers'

const createEntry = async (token: string, lemma: string) =>
  createEntryResultSchema.parse((await call('/manage/v1/entries', { method: 'POST', token, json: { lemma } })).body)
const createSense = async (token: string, entryId: string, pos: string, gloss: string) =>
  createSenseResultSchema.parse(
    (await call('/manage/v1/senses', { method: 'POST', token, json: { entry_id: entryId, pos, gloss } })).body,
  )
const submit = (token: string, json: unknown) => call('/manage/v1/facts', { method: 'POST', token, json })
const refusal = (result: { status: number; body: unknown }) => [
  result.status,
  apiErrorSchema.parse(result.body).error.code,
  apiErrorSchema.parse(result.body).error.message,
]

describe('grammar, word formation, and collocations', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reviews and publishes them on the public entry and sense [spec: catalog/usage-facts-api]', async () => {
    const token = await issueAgentKey()
    const { entry } = await createEntry(token, 'decide')
    const { sense } = await createSense(token, entry.id, 'verb', 'To make a choice after thinking.')
    const facts = [
      {
        kind: 'grammar',
        subject_id: sense.id,
        payload: { transitivity: 'both', patterns: ['to_infinitive', 'that_clause'] },
      },
      { kind: 'morphology', subject_id: entry.id, payload: { parts: [{ form: 'decide', role: 'base' }] } },
      { kind: 'collocation', subject_id: sense.id, payload: { text: 'decide against', pattern: 'verb_preposition' } },
    ]
    const ids: string[] = []
    for (const json of facts) {
      const result = await submit(token, json)
      expect(result.status).toBe(201)
      ids.push(factWriteResultSchema.parse(result.body).fact.id)
    }
    const gateway = stubReviewers()
    await deliverPendingReviews()
    const grammar = factSchema.parse((await call(`/manage/v1/facts/${ids[0]}`, { token })).body)
    expect(grammar).toMatchObject({ status: 'published', review: { reviewer: 'jev', verdict: 'pass' } })
    expect(Object.keys(grammar.review?.detail.answers as object)).toEqual([
      'transitivity',
      'pattern_to_infinitive',
      'pattern_that_clause',
    ])
    const collocation = factSchema.parse((await call(`/manage/v1/facts/${ids[2]}`, { token })).body)
    expect(collocation).toMatchObject({ status: 'published', review: { reviewer: 'llm' } })
    expect(gateway).toHaveBeenCalled()

    const meta = { confidence: 0.93, verdict: 'pass' }
    const view = publicEntrySchema.parse((await call('/v1/entries/decide')).body)
    expect(view.morphology).toEqual({ id: ids[1], ...meta, parts: [{ form: 'decide', role: 'base' }] })
    const [published] = view.senses
    expect(published?.grammar).toEqual({
      id: ids[0],
      ...meta,
      transitivity: 'both',
      patterns: ['to_infinitive', 'that_clause'],
    })
    expect(published?.collocations).toEqual([
      { id: ids[2], confidence: 0.88, verdict: 'pass', text: 'decide against', pattern: 'verb_preposition' },
    ])
    const single = publicSenseWithEntrySchema.parse((await call(`/v1/senses/${sense.id}`)).body)
    expect(single.grammar?.id).toBe(ids[0])
  })

  it('refuses payloads that do not fit their subject with 422 and malformed ones with 400 [spec: facts/usage-admission-api]', async () => {
    const token = await issueAgentKey()
    const { entry } = await createEntry(token, 'quick')
    const { sense } = await createSense(token, entry.id, 'adjective', 'Moving fast.')
    const phrase = await createEntry(token, 'quick fix')

    expect(
      refusal(await submit(token, { kind: 'grammar', subject_id: sense.id, payload: { countability: 'countable' } })),
    ).toEqual([
      422,
      'invalid_reference',
      'The grammar of an adjective sense names only position and patterns; remove countability.',
    ])
    expect(
      refusal(await submit(token, { kind: 'grammar', subject_id: sense.id, payload: { patterns: ['two_objects'] } })),
    ).toEqual([422, 'invalid_reference', expect.stringContaining('two_objects is not a pattern of an adjective')])
    expect(
      refusal(
        await submit(token, {
          kind: 'morphology',
          subject_id: phrase.entry.id,
          payload: {
            parts: [
              { form: 'quick', role: 'base' },
              { form: 'fix', role: 'base' },
            ],
          },
        }),
      ),
    ).toEqual([422, 'invalid_reference', 'A word formation describes a single word; "quick fix" is a phrase.'])
    expect(
      refusal(
        await submit(token, {
          kind: 'morphology',
          subject_id: entry.id,
          payload: { parts: [{ form: 'quack', role: 'base' }] },
        }),
      ),
    ).toEqual([422, 'invalid_reference', expect.stringContaining('do not spell "quick"')])
    expect(
      refusal(
        await submit(token, {
          kind: 'collocation',
          subject_id: sense.id,
          payload: { text: 'fast learner', pattern: 'adjective_noun' },
        }),
      ),
    ).toEqual([422, 'invalid_reference', expect.stringContaining('has neither "quick"')])
    expect(
      refusal(
        await submit(token, {
          kind: 'collocation',
          subject_id: sense.id,
          payload: { text: 'quick', pattern: 'phrase' },
        }),
      ),
    ).toEqual([400, 'invalid_request', expect.stringContaining('at least two words')])
    expect(
      (await submit(token, { kind: 'grammar', subject_id: sense.id, payload: { position: 'attributive_only' } }))
        .status,
    ).toBe(201)
  })

  it('corrects grammar and a collocation at the limit, one correction at a time [spec: facts/usage-corrections-api]', async () => {
    const token = await issueAgentKey()
    const { entry } = await createEntry(token, 'rain')
    const { sense } = await createSense(token, entry.id, 'noun', 'Water that falls from clouds in drops.')
    const write = async (json: unknown) => {
      const result = await submit(token, json)
      expect(result.status).toBe(201)
      return factWriteResultSchema.parse(result.body).fact
    }
    const grammar = (countability: string, supersedes_id?: string) => ({
      kind: 'grammar',
      subject_id: sense.id,
      payload: { countability },
      ...(supersedes_id ? { supersedes_id } : {}),
    })
    const collocation = (text: string, supersedes_id?: string) => ({
      kind: 'collocation',
      subject_id: sense.id,
      payload: { text, pattern: 'adjective_noun' },
      ...(supersedes_id ? { supersedes_id } : {}),
    })
    const original = await write(grammar('countable'))
    const collocations = []
    for (const text of ['heavy rain', 'light rain', 'pouring rain', 'steady rain', 'acid rain']) {
      collocations.push(await write(collocation(text)))
    }
    stubReviewers()
    await deliverPendingReviews()
    const [weak] = collocations
    if (!weak) throw new Error('No collocation.')
    const limit = 'A sense holds at most 5 live collocation facts; retract one before adding another.'
    const corrected = 'The fact this corrects already has a live correction; retract that one or wait for its review.'
    expect(refusal(await submit(token, collocation('torrential rain')))).toEqual([409, 'conflict', limit])

    const grammarFix = await write(grammar('uncountable', original.id))
    const collocationFix = await write(collocation('torrential rain', weak.id))
    expect(refusal(await submit(token, grammar('both', original.id)))).toEqual([409, 'conflict', corrected])
    expect(refusal(await submit(token, collocation('driving rain', weak.id)))).toEqual([409, 'conflict', corrected])

    await deliverPendingReviews()
    const statusOf = async (id: string) =>
      factSchema.parse((await call(`/manage/v1/facts/${id}`, { token })).body).status
    expect(await Promise.all([grammarFix, collocationFix, original, weak].map((fact) => statusOf(fact.id)))).toEqual([
      'published',
      'published',
      'superseded',
      'superseded',
    ])
    const live = await call(`/v1/senses/${sense.id}`)
    const view = publicSenseWithEntrySchema.parse(live.body)
    expect(view.grammar).toMatchObject({ id: grammarFix.id, countability: 'uncountable' })
    expect(view.collocations.map((fact) => fact.id).sort()).toEqual(
      [collocationFix.id, ...collocations.slice(1).map((fact) => fact.id)].sort(),
    )
  })
})
