import { webpHeader } from '@server/testing/webp'
import { describe, expect, it } from 'vitest'
import { mediaIdOf, TOPIC_IMAGE, topicImageProblem, webpSize } from './media'

describe('webpSize', () => {
  it('reads the size a lossy, lossless, or extended WebP declares, and none from other files [spec: topics/image-format]', () => {
    expect(webpSize(webpHeader(1024, 768))).toEqual({ width: 1024, height: 768 })
    expect(webpSize(webpHeader(300, 200, { chunk: 'VP8L' }))).toEqual({ width: 300, height: 200 })
    expect(webpSize(webpHeader(4000, 3000, { chunk: 'VP8X' }))).toEqual({ width: 4000, height: 3000 })

    const png = new Uint8Array(64)
    png.set([0x89, 0x50, 0x4e, 0x47])
    expect(webpSize(png)).toBeNull()
    expect(webpSize(webpHeader(1024, 1024).subarray(0, 20))).toBeNull()
    const other = webpHeader(1024, 1024)
    other.set([0x41, 0x4c, 0x50, 0x48], 12) // an ALPH chunk first is no WebP an encoder writes
    expect(webpSize(other)).toBeNull()
    const badStart = webpHeader(1024, 1024)
    badStart[23] = 0
    expect(webpSize(badStart)).toBeNull()
    const badSignature = webpHeader(1024, 1024, { chunk: 'VP8L' })
    badSignature[20] = 0
    expect(webpSize(badSignature)).toBeNull()
  })
})

describe('topicImageProblem', () => {
  it('accepts a 1024×1024 WebP within the size limit and names what is wrong with anything else', () => {
    expect(topicImageProblem(webpHeader(1024, 1024))).toBeNull()
    expect(topicImageProblem(webpHeader(1024, 1024, { chunk: 'VP8X' }))).toBeNull()
    expect(topicImageProblem(new Uint8Array(64))).toBe('A topic image is a WebP file.')
    expect(topicImageProblem(webpHeader(1254, 1254))).toBe('A topic image is 1024×1024; this one is 1254×1254.')
    expect(topicImageProblem(webpHeader(1024, 1024, { length: TOPIC_IMAGE.maxBytes + 1 }))).toBe(
      `A topic image is at most ${TOPIC_IMAGE.maxBytes} bytes; this one is ${TOPIC_IMAGE.maxBytes + 1}.`,
    )
  })
})

describe('mediaIdOf', () => {
  it('names a file by the lowercase hex SHA-256 of its bytes', async () => {
    expect(await mediaIdOf(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
