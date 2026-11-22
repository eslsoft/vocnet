import { mediaUrl } from '@shared/media'
import { describe, expect, it } from 'vitest'
import { absoluteMediaBase } from './media-base'

describe('absoluteMediaBase', () => {
  it("keeps an absolute base and resolves a path against the request's origin [spec: media/absolute-base]", () => {
    expect(absoluteMediaBase('https://images.example.com', 'http://localhost:5173/v1/entries/run')).toBe(
      'https://images.example.com',
    )
    const base = absoluteMediaBase('/v1/media', 'https://branch-vocnet.example.dev/v1/topics?lang=zh')
    expect(base).toBe('https://branch-vocnet.example.dev/v1/media')
    expect(mediaUrl(base, 'a'.repeat(64))).toBe(`https://branch-vocnet.example.dev/v1/media/${'a'.repeat(64)}`)
  })
})
