import { agentA } from '@server/testing/actors'
import { fakeWorld } from '@server/testing/fakes'
import { describe, expect, it } from 'vitest'
import { createEntry, getManagedEntry, getPublicEntry } from './catalog'
import { listReferenceSources } from './reference'
import { reviewFact } from './review'

const wordfreq = {
  id: 'wordfreq',
  name: 'wordfreq',
  version: '3.1.1',
  license: 'CC BY-SA 4.0',
  license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  changes: 'Filtered and ranked by Vocnet.',
  attribution: 'Robyn Speer',
  url: 'https://github.com/rspeer/wordfreq',
  retrieved_at: '2026-11-09',
}

describe('reference data', () => {
  it('lists the reference sources', async () => {
    const world = fakeWorld()
    world.referenceSources.push(wordfreq)
    expect(await listReferenceSources(world.deps)).toEqual([wordfreq])
  })

  it('joins the reference data of the exact lemma into the entry views', async () => {
    const world = fakeWorld()
    const reference = {
      frequency: { zipf: 5.16, rank: 691, source_id: 'wordfreq' },
      cefr: [{ pos: 'noun' as const, level: 'A1' as const, source_id: 'cefrj' }],
    }
    world.referenceSources.push(wordfreq, { ...wordfreq, id: 'cefrj', name: 'CEFR-J Wordlist' })
    world.references.set('bank', reference)
    world.references.set('Bank', { frequency: null, cefr: [] })
    await createEntry(world.deps, agentA, { lemma: ' bank ' })
    for (const fact of [...world.facts]) await reviewFact(world.deps, fact.id, 'trace')

    expect(await getPublicEntry(world.deps, 'bank')).toMatchObject({ lemma: 'bank', ...reference })
    expect(await getManagedEntry(world.deps, 'bank')).toMatchObject({ seed: false, ...reference })
  })
})
