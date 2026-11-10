import { env } from 'cloudflare:test'
import { createEntryResultSchema, createSenseResultSchema } from '@shared/catalog'
import { factWriteResultSchema } from '@shared/facts'
import { apiErrorSchema } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { call, issueAgentKey } from './helpers'

async function agent() {
  const token = await issueAgentKey()
  const post = (path: string, json: unknown) => call(path, { method: 'POST', token, json })
  /** Creates an entry with one noun sense per gloss and returns the sense ids. */
  const entry = async (lemma: string, ...glosses: string[]) => {
    const { entry } = createEntryResultSchema.parse((await post('/manage/v1/entries', { lemma })).body)
    const ids: string[] = []
    for (const gloss of glosses) {
      const created = await post('/manage/v1/senses', { entry_id: entry.id, pos: 'noun', gloss })
      ids.push(createSenseResultSchema.parse(created.body).sense.id)
    }
    return ids
  }
  const relate = (type: string, from: string, to: string) =>
    post('/manage/v1/facts', { kind: 'relation', subject_id: from, payload: { type, target_sense_id: to } })
  return { entry, relate }
}

describe('relation write rules', () => {
  it('refuses a second relation type to the same entry and a hypernym 2-cycle with 422 [spec: facts/relation-write-rules-api]', async () => {
    const { entry, relate } = await agent()
    const [number] = await entry('number', 'A quantity of people or things.')
    const [quantity, measure] = await entry('quantity', 'An amount of something.', 'A measurable property.')
    const synonym = await relate('synonym', quantity as string, number as string)
    expect(synonym.status).toBe(201)
    const { fact } = factWriteResultSchema.parse(synonym.body)

    const second = await relate('hypernym', number as string, measure as string)
    expect(second.status).toBe(422)
    expect(apiErrorSchema.parse(second.body)).toMatchObject({
      error: {
        code: 'invalid_reference',
        message: expect.stringContaining(`already has a live synonym relation (${fact.id})`),
      },
    })

    const [shock] = await entry('shock', 'An unexpected upsetting event.')
    const [surprise] = await entry('surprise', 'An unexpected event.')
    expect((await relate('hypernym', shock as string, surprise as string)).status).toBe(201)
    const cycle = await relate('hypernym', surprise as string, shock as string)
    expect(cycle.status).toBe(422)
    expect(apiErrorSchema.parse(cycle.body).error.message).toContain('cannot each be a kind of the other')
  })
})

describe('relations_strict_revalidate migration', () => {
  it('marks weakly reviewed and conflicting published relations for revalidation [spec: facts/relations-strict-revalidate]', async () => {
    const { entry } = await agent()
    const [person] = await entry('person', 'A human being.')
    const [princess] = await entry('princess', 'A woman who rules a principality.')
    const [cop] = await entry('cop', 'A police officer.')
    const [lord] = await entry('lord', 'A nobleman.')
    const [head, cap] = await entry('head', 'The upper part of the body.', 'The top of something.')
    const [sole] = await entry('sole', 'The bottom of a shoe.')
    const [outsole] = await entry('outsole', 'The outer bottom of a shoe.')
    const [wheel] = await entry('wheel', 'A round frame that turns.')
    const [car] = await entry('car', 'A road vehicle.')
    const [shock] = await entry('shock', 'An unexpected upsetting event.')
    const [surprise] = await entry('surprise', 'An unexpected event.')
    const jevThenLlm = (jev: number) =>
      JSON.stringify({
        reviewer: 'jev+llm',
        detail: {
          opinions: [
            { reviewer: 'jev', confidence: jev },
            { reviewer: 'llm', confidence: 0.9 },
          ],
        },
      })
    const jevAlone = JSON.stringify({ reviewer: 'jev', confidence: 0.95, detail: {} })
    const insert = async (type: string, subject: unknown, object: unknown, review: string) => {
      const id = crypto.randomUUID()
      await env.DB.prepare(
        `insert into facts (id, kind, subject_id, object_id, content_key, payload, status, exclusive, author, review, created_at, updated_at)
         values (?, 'relation', ?, ?, ?, ?, 'published', 0, 'agent:legacy', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
        .bind(id, subject, object, `${type}|${object}`, JSON.stringify({ type, target_sense_id: object }), review)
        .run()
      return id
    }
    const marked = {
      princessHead: await insert('part_of', head, princess, jevAlone),
      chainHead: await insert('part_of', head, lord, jevThenLlm(0.7)),
      copHead: await insert('part_of', head, cop, jevThenLlm(0.6)),
      lowJev: await insert('synonym', outsole, sole, jevThenLlm(0.2)),
      crowdedSynonym: await insert('synonym', cap, car, jevAlone),
      crowdedPart: await insert('part_of', cap, car, jevAlone),
      cycleUp: await insert('hypernym', shock, surprise, jevAlone),
      cycleDown: await insert('hypernym', surprise, shock, jevAlone),
    }
    await insert('hypernym', lord, person, jevAlone)
    const kept = {
      wheel: await insert('part_of', wheel, car, jevThenLlm(0.6)),
      person: await insert('part_of', head, person, jevAlone),
    }

    await env.DB.prepare("update facts set status = 'published' where kind in ('entry', 'sense')").run()
    const migration = env.TEST_MIGRATIONS.find((candidate) =>
      candidate.name.endsWith('_relations_strict_revalidate.sql'),
    )
    if (!migration) throw new Error('The relations_strict_revalidate migration is missing.')
    for (const query of migration.queries) await env.DB.prepare(query).run()

    const mark = (id: string) =>
      env.DB.prepare('SELECT revalidate_since AS mark FROM facts WHERE id = ?')
        .bind(id)
        .first<{ mark: string | null }>()
    for (const id of Object.values(marked)) expect((await mark(id))?.mark).toEqual(expect.any(String))
    for (const id of Object.values(kept)) expect((await mark(id))?.mark).toBeNull()
  })
})
