import { publicEntrySchema } from '@shared/catalog'
import { workItemOverviewListSchema } from '@shared/monitor'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminToken, call, headword, issueAgentKey, readFact, reviewPending, submit, submitOk } from './helpers'

const read = async (lemma: string, query = '') =>
  publicEntrySchema.parse((await call(`/v1/entries/${lemma}${query}`)).body)

describe('translations', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps one translation fact per translated item and language [spec: facts/translation-per-item-api]', async () => {
    const { entryId, senses } = await headword('rain', [
      { pos: 'noun', gloss: 'Water that falls from clouds in drops.' },
    ])
    const sense = senses[0] as string
    const token = await issueAgentKey()
    const example = await submitOk(token, 'example', sense, { text: 'Rain fell all night.' })
    const collocation = await submitOk(token, 'collocation', sense, { text: 'heavy rain', pattern: 'adjective_noun' })
    await reviewPending()

    const translations = [
      await submitOk(token, 'translation', sense, { language: 'zh', of: 'sense', text: '雨' }),
      await submitOk(token, 'translation', example.id, { language: 'zh', of: 'example', text: '雨下了一整夜。' }),
      await submitOk(token, 'translation', collocation.id, { language: 'zh', of: 'collocation', text: '大雨' }),
    ]
    const second = await submit(token, 'translation', sense, { language: 'zh', of: 'sense', text: '雨水' })
    expect([second.status, apiErrorSchema.parse(second.body).error.code]).toEqual([409, 'conflict'])
    const wrongSubject = await submit(token, 'translation', sense, { language: 'zh', of: 'example', text: '下雨。' })
    expect([wrongSubject.status, apiErrorSchema.parse(wrongSubject.body).error.code]).toEqual([
      422,
      'invalid_reference',
    ])

    await reviewPending()
    for (const translation of translations) expect((await readFact(translation.id)).status).toBe('published')
    const zh = (await read('rain', '?lang=zh')).meanings[0]?.senses[0]
    expect(zh?.translations).toEqual(['雨'])
    expect(zh?.examples).toEqual([{ text: 'Rain fell all night.', translation: '雨下了一整夜。' }])
    expect(zh?.collocations).toEqual([{ text: 'heavy rain', pattern: 'adjective_noun', translation: '大雨' }])

    const corrected = await submitOk(
      token,
      'example',
      sense,
      { text: 'Rain fell all through the night.' },
      { supersedes_id: example.id },
    )
    await reviewPending()
    expect((await read('rain', '?lang=zh')).meanings[0]?.senses[0]?.examples).toEqual([
      { text: 'Rain fell all through the night.' },
    ])
    const items = workItemOverviewListSchema.parse(
      (await call(`/manage/v1/work/items?entry_id=${entryId}`, { token: await adminToken() })).body,
    ).items
    const item = items.find((candidate) => candidate.type === 'translations')
    expect(item?.gap).toEqual({ type: 'translations', language: 'zh', missing: [{ of: 'example', id: corrected.id }] })
  })

  it('validates, reviews, and serves syllables, form pronunciations, and example translations [spec: catalog/new-fields-api]', async () => {
    const { entryId, senses } = await headword('go', [{ pos: 'verb', gloss: 'To move or travel somewhere.' }])
    const token = await issueAgentKey()
    expect((await submit(token, 'syllables', entryId, { syllables: ['g', 'oo'] })).status).toBe(422)
    expect((await submit(token, 'syllables', entryId, { syllables: ['go'] })).status).toBe(201)
    const form = (payload: object) => submit(token, 'form', entryId, { form: 'went', type: 'past', ...payload })
    expect((await form({ ipa: '/went/', accent: 'us' })).status).toBe(400)
    expect((await form({ ipa: 'went' })).status).toBe(400)
    expect((await form({ ipa: 'went', accent: 'us' })).status).toBe(201)
    const example = await submitOk(token, 'example', senses[0] as string, { text: 'We go home.' })
    const translate = (language: string) =>
      submit(token, 'translation', example.id, { language, of: 'example', text: '我们回家。' })
    expect((await translate('zh-Hant')).status).toBe(400)
    expect((await translate('zh')).status).toBe(201)
    await reviewPending()

    const zh = await read('go', '?lang=zh')
    expect(zh.syllables).toEqual(['go'])
    expect(zh.meanings[0]?.forms).toEqual({ past: [{ form: 'went', irregular: true, ipa: 'went', accent: 'us' }] })
    expect(zh.meanings[0]?.senses[0]?.examples).toEqual([{ text: 'We go home.', translation: '我们回家。' }])
    const all = await read('go', '?lang=all')
    expect(all.meanings[0]?.senses[0]?.examples).toEqual([{ text: 'We go home.', translation: { zh: '我们回家。' } }])
    expect((await read('go')).meanings[0]?.senses[0]?.examples).toEqual([{ text: 'We go home.' }])
  })
})
