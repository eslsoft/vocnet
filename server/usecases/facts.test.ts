import { admin, agentA, agentB } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import type { FactId, SenseId } from '@shared/facts'
import { describe, expect, it } from 'vitest'
import { createEntry, createSense } from './catalog'
import { getFact, listFacts, rereviewFact, retractFact, submitFact } from './facts'
import { reviewFact } from './review'

async function bankWorld() {
  const world = fakeWorld()
  const { entry } = await createEntry(world.deps, agentA, { lemma: 'bank' })
  const river = await createSense(world.deps, agentA, { entry_id: entry.id, pos: 'noun', gloss: 'land beside a river' })
  const money = await createSense(world.deps, agentA, {
    entry_id: entry.id,
    pos: 'noun',
    gloss: 'a financial institution',
  })
  for (const job of world.queued.splice(0)) await reviewFact(world.deps, job.factId, job.traceId)
  return { world, entry, river: river.sense, money: money.sense, riverGloss: river.fact }
}

async function withShore() {
  const bank = await bankWorld()
  const { entry } = await createEntry(bank.world.deps, agentA, { lemma: 'shore' })
  const { sense: shore } = await createSense(bank.world.deps, agentA, {
    entry_id: entry.id,
    pos: 'noun',
    gloss: 'land along water',
  })
  bank.world.queued.length = 0
  return { ...bank, shore }
}

describe('submitFact', () => {
  it('stores a pending fact authored by the actor and enqueues its review', async () => {
    const { world, river } = await bankWorld()
    const { fact, created } = await submitFact(world.deps, agentB, {
      kind: 'example',
      subject_id: river.id,
      payload: { text: 'We sat on the bank.' },
    })
    expect(created).toBe(true)
    expect(fact).toMatchObject({ status: 'pending', author: 'agent:agent-b', review: null, objectId: null })
    expect(world.queued).toEqual([{ factId: fact.id, traceId: 'trace-b' }])
  })

  it('returns the live fact instead of a duplicate and enqueues nothing [spec: facts/dedupe]', async () => {
    const { world, river } = await bankWorld()
    const input = { kind: 'example' as const, subject_id: river.id, payload: { text: 'We sat on the bank.' } }
    const first = await submitFact(world.deps, agentA, input)
    const again = await submitFact(world.deps, agentB, { ...input, payload: { text: ' we sat on the BANK. ' } })
    expect(again).toEqual({ fact: first.fact, created: false })
    expect(world.queued).toHaveLength(1)
  })

  it('accepts a fresh submission once the earlier one was rejected', async () => {
    const { world, river } = await bankWorld()
    world.answerLlm(() => ({ model: 'm', verdict: 'fail', confidence: 0.9, reason: 'Wrong sense.' }))
    const input = { kind: 'example' as const, subject_id: river.id, payload: { text: 'I robbed a bank.' } }
    const first = await submitFact(world.deps, agentA, input)
    await reviewFact(world.deps, first.fact.id, 'trace-review')
    expect((await submitFact(world.deps, agentA, input)).created).toBe(true)
  })

  it("rejects a subject that is not the kind's subject type [spec: facts/subject-validation]", async () => {
    const { world, entry, river } = await bankWorld()
    await expect(
      submitFact(world.deps, agentA, { kind: 'example', subject_id: entry.id, payload: { text: 'x' } }),
    ).rejects.toMatchObject({ code: 'invalid_reference' })
    await expect(
      submitFact(world.deps, agentA, {
        kind: 'form',
        subject_id: river.id,
        payload: { form: 'banks', type: 'plural' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_reference' })
  })

  it('rejects a relation whose target sense does not exist', async () => {
    const { world, river } = await bankWorld()
    await expect(
      submitFact(world.deps, agentA, {
        kind: 'relation',
        subject_id: river.id,
        payload: { type: 'synonym', target_sense_id: '00000000-0000-4000-8000-0000000000ff' as never },
      }),
    ).rejects.toMatchObject({ code: 'invalid_reference', message: expect.stringContaining('Target sense') })
  })

  it('records the target sense as the object of a relation', async () => {
    const { world, river, shore } = await withShore()
    const { fact } = await submitFact(world.deps, agentA, {
      kind: 'relation',
      subject_id: shore.id,
      payload: { type: 'hypernym', target_sense_id: river.id },
    })
    expect(fact).toMatchObject({ subjectId: shore.id, objectId: river.id })
  })

  it('stores a symmetric relation once, whichever sense it is submitted from [spec: facts/symmetric-relation-once]', async () => {
    const { world, river, shore } = await withShore()
    const [low, high] = [river.id, shore.id].sort()
    const submit = (type: 'synonym' | 'hypernym', from: string, to: string) =>
      submitFact(world.deps, agentA, {
        kind: 'relation',
        subject_id: from,
        payload: { type, target_sense_id: to as SenseId },
      })
    const first = await submit('synonym', high as string, low as string)
    expect(first.fact).toMatchObject({ subjectId: low, objectId: high, payload: { target_sense_id: high } })
    await expect(submit('synonym', low as string, high as string)).resolves.toEqual({
      fact: first.fact,
      created: false,
    })
    const directed = await submit('hypernym', high as string, low as string)
    expect(directed).toMatchObject({ created: true, fact: { subjectId: high, objectId: low } })
    expect(world.queued).toHaveLength(2)
  })

  it('rejects a relation between two senses of one entry [spec: facts/relation-across-entries]', async () => {
    const { world, river, money } = await bankWorld()
    for (const target of [money.id, river.id]) {
      await expect(
        submitFact(world.deps, agentA, {
          kind: 'relation',
          subject_id: river.id,
          payload: { type: 'antonym', target_sense_id: target },
        }),
      ).rejects.toMatchObject({ code: 'invalid_reference', message: expect.stringContaining('two different entries') })
    }
    expect(world.queued).toHaveLength(0)
  })

  it('lets a correction change only the register of a gloss', async () => {
    const { world, river, riverGloss } = await bankWorld()
    const { fact, created } = await submitFact(world.deps, agentA, {
      kind: 'sense',
      subject_id: river.id,
      supersedes_id: riverGloss.id,
      payload: { gloss: 'land beside a river', register: 'literary' },
    })
    expect(created).toBe(true)
    expect(fact).toMatchObject({ supersedesId: riverGloss.id, payload: { register: 'literary' } })
  })

  it('accepts a correction only of a published fact of the same kind and subject [spec: facts/supersede-rules]', async () => {
    const { world, river, money, riverGloss } = await bankWorld()
    const correct = (supersedes: FactId, subject = river.id, kind: 'sense' | 'example' = 'sense') =>
      submitFact(world.deps, agentA, {
        kind,
        subject_id: subject,
        supersedes_id: supersedes,
        payload: kind === 'sense' ? { gloss: 'sloping land beside a river' } : { text: 'x' },
      } as never)

    await expect(correct('00000000-0000-4000-8000-0000000000ff' as FactId)).rejects.toMatchObject({
      code: 'invalid_reference',
    })
    await expect(correct(riverGloss.id, money.id)).rejects.toMatchObject({ code: 'invalid_reference' })
    await expect(correct(riverGloss.id, river.id, 'example')).rejects.toMatchObject({ code: 'invalid_reference' })

    const { fact: example } = await submitFact(world.deps, agentA, {
      kind: 'example',
      subject_id: river.id,
      payload: { text: 'We sat on the bank.' },
    })
    await expect(correct(example.id, river.id, 'example')).rejects.toMatchObject({ code: 'conflict' })

    const { fact, created } = await correct(riverGloss.id)
    expect(created).toBe(true)
    expect(fact.supersedesId).toBe(riverGloss.id)
  })

  it('keeps single-valued kinds to one live fact per subject [spec: facts/single-gloss]', async () => {
    const { world, river, riverGloss } = await bankWorld()
    await expect(
      submitFact(world.deps, agentA, { kind: 'sense', subject_id: river.id, payload: { gloss: 'another gloss' } }),
    ).rejects.toMatchObject({ code: 'conflict' })
    const input = { kind: 'sense' as const, subject_id: river.id, supersedes_id: riverGloss.id }
    await submitFact(world.deps, agentA, { ...input, payload: { gloss: 'first correction' } })
    await expect(
      submitFact(world.deps, agentA, { ...input, payload: { gloss: 'second correction' } }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('reading facts', () => {
  it('gets a fact by id and 404s an unknown one', async () => {
    const { world, riverGloss } = await bankWorld()
    await expect(getFact(world.deps, riverGloss.id)).resolves.toMatchObject({ id: riverGloss.id })
    await expect(getFact(world.deps, 'missing' as FactId)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('lists facts filtered by status and kind', async () => {
    const { world } = await bankWorld()
    const page = await listFacts(world.deps, { status: 'published', kind: 'sense' }, { limit: 10 })
    expect(page.items).toHaveLength(2)
  })
})

describe('retractFact', () => {
  it('lets the author retract, and retracting again returns the same fact [spec: facts/retract]', async () => {
    const { world, riverGloss } = await bankWorld()
    const retracted = await retractFact(world.deps, agentA, riverGloss.id)
    expect(retracted.status).toBe('retracted')
    await expect(retractFact(world.deps, agentA, riverGloss.id)).resolves.toMatchObject({ status: 'retracted' })
  })

  it("forbids an agent from retracting another agent's fact, but not an admin", async () => {
    const { world, riverGloss } = await bankWorld()
    await expect(retractFact(world.deps, agentB, riverGloss.id)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(retractFact(world.deps, admin, riverGloss.id)).resolves.toMatchObject({ status: 'retracted' })
  })

  it('refuses facts that are already decided otherwise', async () => {
    const { world, river } = await bankWorld()
    world.answerLlm(() => ({ model: 'm', verdict: 'fail', confidence: 0.9, reason: 'No.' }))
    const { fact } = await submitFact(world.deps, agentA, {
      kind: 'example',
      subject_id: river.id,
      payload: { text: 'x' },
    })
    await reviewFact(world.deps, fact.id, 'trace-review')
    await expect(retractFact(world.deps, agentA, fact.id)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('reports a concurrent change instead of claiming success', async () => {
    const { world, riverGloss } = await bankWorld()
    world.deps.facts.transition = async () => false
    await expect(retractFact(world.deps, agentA, riverGloss.id)).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('rereviewFact', () => {
  it('resets a decided fact to pending and enqueues it [spec: facts/rereview]', async () => {
    const { world, riverGloss } = await bankWorld()
    const fact = await rereviewFact(world.deps, admin, riverGloss.id)
    expect(fact.status).toBe('pending')
    expect(world.queued).toEqual([{ factId: riverGloss.id, traceId: 'trace-admin' }])
  })

  it('re-enqueues a pending fact without changing it', async () => {
    const { world, river } = await bankWorld()
    const { fact } = await submitFact(world.deps, agentA, {
      kind: 'example',
      subject_id: river.id,
      payload: { text: 'x' },
    })
    world.queued.length = 0
    await expect(rereviewFact(world.deps, admin, fact.id)).resolves.toMatchObject({ status: 'pending' })
    expect(world.queued).toHaveLength(1)
  })

  it('refuses retracted facts and rejected facts whose slot is taken', async () => {
    const { world, river, riverGloss } = await bankWorld()
    await retractFact(world.deps, agentA, riverGloss.id)
    await expect(rereviewFact(world.deps, admin, riverGloss.id)).rejects.toMatchObject({ code: 'conflict' })

    world.answerLlm(() => ({ model: 'm', verdict: 'fail', confidence: 0.9, reason: 'No.' }))
    const input = { kind: 'example' as const, subject_id: river.id, payload: { text: 'x' } }
    const { fact: rejected } = await submitFact(world.deps, agentA, input)
    await reviewFact(world.deps, rejected.id, 'trace-review')
    await submitFact(world.deps, agentA, input)
    await expect(rereviewFact(world.deps, admin, rejected.id)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('lets a rejected fact go back to review when its slot is free', async () => {
    const { world, river } = await bankWorld()
    world.answerLlm(() => ({ model: 'm', verdict: 'fail', confidence: 0.9, reason: 'No.' }))
    const { fact } = await submitFact(world.deps, agentA, {
      kind: 'example',
      subject_id: river.id,
      payload: { text: 'x' },
    })
    await reviewFact(world.deps, fact.id, 'trace-review')
    await expect(rereviewFact(world.deps, admin, fact.id)).resolves.toMatchObject({ status: 'pending' })
  })

  it('refuses a rejected correction whose original is no longer published', async () => {
    const { world, river, riverGloss } = await bankWorld()
    const correction = { kind: 'sense' as const, subject_id: river.id, supersedes_id: riverGloss.id }
    world.failReviews()
    const { fact: rejected } = await submitFact(world.deps, agentA, { ...correction, payload: { gloss: 'a fish' } })
    await reviewFact(world.deps, rejected.id, 'trace-review')
    await retractFact(world.deps, agentA, riverGloss.id)
    await expect(rereviewFact(world.deps, admin, rejected.id)).rejects.toMatchObject({ code: 'conflict' })
    expect((await getFact(world.deps, rejected.id)).status).toBe('rejected')
  })

  it('reports a concurrent change', async () => {
    const { world, riverGloss } = await bankWorld()
    world.deps.facts.transition = async () => false
    await expect(rereviewFact(world.deps, admin, riverGloss.id)).rejects.toMatchObject({ code: 'conflict' })
  })
})
