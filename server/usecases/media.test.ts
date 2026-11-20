import { fakeWorld } from '@server/testing/fakes'
import { webpHeader } from '@server/testing/webp'
import { describe, expect, it } from 'vitest'
import { readMedia } from './media'

describe('readMedia', () => {
  it('reads a stored file by its id, and an id no file has is not found', async () => {
    const world = fakeWorld()
    const bytes = webpHeader(1024, 1024)
    await world.deps.media.put('a'.repeat(64), bytes, 'image/webp')
    const file = await readMedia(world.deps, 'a'.repeat(64))
    expect(file).toMatchObject({ contentType: 'image/webp', size: bytes.length })
    expect(new Uint8Array(await new Response(file.body).arrayBuffer())).toEqual(bytes)
    await expect(readMedia(world.deps, 'b'.repeat(64))).rejects.toMatchObject({ code: 'not_found' })
  })
})
