import { publicEntrySchema, publicSenseDetailSchema } from '@shared/catalog'
import { factSchema, factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { admit, call, deliverPendingReviews, headword, issueAgentKey, publishInventory, stubReviewers } from './helpers'

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
    const { entryId, senses } = await headword('decide', [{ pos: 'verb', gloss: 'To make a choice after thinking.' }])
    const entry = { id: entryId }
    const sense = { id: senses[0] as string }
    const facts = [
      {
        kind: 'grammar',
        subject_id: sense.id,
        payload: { transitivity: 'both', patterns: ['to_infinitive', 'that_clause'], prepositions: ['on'] },
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
      'preposition_on',
    ])
    const collocation = factSchema.parse((await call(`/manage/v1/facts/${ids[2]}`, { token })).body)
    expect(collocation).toMatchObject({ status: 'published', review: { reviewer: 'llm' } })
    expect(gateway).toHaveBeenCalled()

    const meta = { confidence: 0.93, verdict: 'pass' }
    const view = publicEntrySchema.parse((await call('/v1/entries/decide?include=review')).body)
    expect(view.morphology).toEqual({
      parts: [{ form: 'decide', role: 'base', lemma: 'decide' }],
      family: [],
      // Jev's pass settles a word formation.
      review: { fact_id: ids[1], ...meta },
    })
    const [published] = view.meanings[0]?.senses ?? []
    expect(published?.grammar).toEqual({
      transitivity: 'both',
      patterns: ['to_infinitive', 'that_clause'],
      prepositions: ['on'],
      review: { fact_id: ids[0], ...meta },
    })
    expect(published?.collocations).toEqual([
      {
        text: 'decide against',
        pattern: 'verb_preposition',
        review: { fact_id: ids[2], confidence: 0.88, verdict: 'pass' },
      },
    ])
    const single = publicSenseDetailSchema.parse((await call(`/v1/senses/${sense.id}?include=review`)).body)
    expect(single.grammar?.review?.fact_id).toBe(ids[0])
  })

  it('refuses payloads that do not fit their subject with 422 and malformed ones with 400 [spec: facts/usage-admission-api]', async () => {
    const token = await issueAgentKey()
    const { entryId, senses } = await headword('quick', [{ pos: 'adjective', gloss: 'Moving fast.' }])
    const entry = { id: entryId }
    const sense = { id: senses[0] as string }
    const phraseId = await admit('quick fix')
    await publishInventory(phraseId, [{ pos: 'noun', gloss: 'A fast but temporary solution.' }])
    const phrase = { entry: { id: phraseId } }

    expect(
      refusal(await submit(token, { kind: 'grammar', subject_id: sense.id, payload: { countability: 'countable' } })),
    ).toEqual([
      422,
      'invalid_reference',
      'The grammar of an adjective sense names only position, patterns, and prepositions; remove countability.',
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
    const { senses } = await headword('rain', [{ pos: 'noun', gloss: 'Water that falls from clouds in drops.' }])
    const sense = { id: senses[0] as string }
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
    const live = await call(`/v1/senses/${sense.id}?include=review`)
    const view = publicSenseDetailSchema.parse(live.body)
    expect(view.grammar).toMatchObject({ review: { fact_id: grammarFix.id }, countability: 'uncountable' })
    expect(view.collocations.map((fact) => fact.review?.fact_id).sort()).toEqual(
      [collocationFix.id, ...collocations.slice(1).map((fact) => fact.id)].sort(),
    )
  })
})
