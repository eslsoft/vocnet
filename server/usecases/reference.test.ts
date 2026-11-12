import { fakeWorld } from '@server/testing/fakes'
import { publicEntryOf } from '@server/testing/public-view'
import { headword } from '@server/testing/seed'
import { describe, expect, it } from 'vitest'
import { getManagedEntry } from './catalog'
import { listReferenceSources } from './reference'

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
    await headword(world, ' bank ', [{ pos: 'noun', gloss: 'land beside a river' }])

    // The public entry names no source, and shows CEFR per meaning.
    expect(await publicEntryOf(world.deps, 'bank')).toMatchObject({
      lemma: 'bank',
      frequency: { zipf: 5.16, rank: 691 },
      meanings: [{ pos: 'noun', cefr: 'A1' }],
    })
    expect(await getManagedEntry(world.deps, 'bank')).toMatchObject({ batch: 1, ...reference })
  })
})
