import { publicEntrySchema } from '@shared/catalog'
import { factSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adminToken,
  call,
  headword,
  issueAgentKey,
  managed,
  readFact,
  reviewPending,
  submit,
  submitOk,
} from './helpers'

const codeOf = (body: unknown) => apiErrorSchema.parse(body).error.code

async function riverBank() {
  const { senses } = await headword('bank', [{ pos: 'noun', gloss: 'Land beside a river.' }])
  return { token: await issueAgentKey(), sense: senses[0] as string }
}

describe('fact slots and corrections', () => {
  afterEach(() => vi.restoreAllMocks())

  it('publishes a correction and supersedes the original in one write [spec: facts/supersede-api]', async () => {
    const { token, sense } = await riverBank()
    const original = await submitOk(token, 'example', sense, { text: 'We sat on the bank.' })
    await reviewPending()
    const correction = await submitOk(
      token,
      'example',
      sense,
      { text: 'We sat on the river bank.' },
      { supersedes_id: original.id },
    )
    await reviewPending()
    expect((await readFact(correction.id)).status).toBe('published')
    expect((await readFact(original.id)).status).toBe('superseded')
    const entry = publicEntrySchema.parse((await call('/v1/entries/bank')).body)
    expect(entry.meanings[0]?.senses[0]?.examples.map((example) => example.text)).toEqual(['We sat on the river bank.'])
  })

  it('sends a rejected fact back through review until it publishes [spec: facts/rereview-api]', async () => {
    const { token, sense } = await riverBank()
    const fact = await submitOk(token, 'example', sense, { text: 'Children played on the bank.' })
    await reviewPending({ verdict: 'fail' })
    expect((await readFact(fact.id)).status).toBe('rejected')
    const admin = await adminToken()
    const reset = await call(`/manage/v1/facts/${fact.id}/rereview`, { method: 'POST', token: admin })
    expect(factSchema.parse(reset.body).status).toBe('pending')
    await reviewPending()
    expect(await readFact(fact.id)).toMatchObject({ status: 'published', review: { verdict: 'pass' } })
    const entry = publicEntrySchema.parse((await call('/v1/entries/bank')).body)
    expect(entry.meanings[0]?.senses[0]?.examples.map((example) => example.text)).toEqual([
      'Children played on the bank.',
    ])
    const published = await call(`/manage/v1/facts/${fact.id}/rereview`, { method: 'POST', token: admin })
    expect([published.status, codeOf(published.body)]).toEqual([409, 'conflict'])
  })

  it('admits one of two concurrent corrections [spec: facts/exclusive-slot-race]', async () => {
    const { token, sense } = await riverBank()
    const grammar = await submitOk(token, 'grammar', sense, { countability: 'countable' })
    await reviewPending()
    const correct = (countability: string) =>
      submit(token, 'grammar', sense, { countability }, { supersedes_id: grammar.id })
    const results = await Promise.all([correct('uncountable'), correct('both')])
    expect(results.map(({ status }) => status).sort()).toEqual([201, 409])
    expect(codeOf(results.find(({ status }) => status === 409)?.body)).toBe('conflict')
    const view = await managed('bank')
    const grammars = view.facts.filter((fact) => fact.kind === 'grammar')
    expect(grammars.map((fact) => fact.status).sort()).toEqual(['pending', 'published'])
  })

  it('refuses a re-review that would put a second live fact in the slot [spec: facts/rereview-conflict]', async () => {
    const { token, sense } = await riverBank()
    const example = { text: 'The bank was muddy.' }
    const rejected = await submitOk(token, 'example', sense, example)
    await reviewPending({ verdict: 'fail' })
    expect((await readFact(rejected.id)).status).toBe('rejected')
    const curator = await issueAgentKey('Curator', true)
    expect((await submit(curator, 'example', sense, example)).status).toBe(201)

    const reset = await call(`/manage/v1/facts/${rejected.id}/rereview`, { method: 'POST', token: await adminToken() })
    expect([reset.status, codeOf(reset.body)]).toEqual([409, 'conflict'])
    expect((await readFact(rejected.id)).status).toBe('rejected')
  })
})
