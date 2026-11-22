import { describe, expect, it } from 'vitest'
import { getMediaBaseUrl } from './config'

describe('media configuration', () => {
  it('takes an absolute URL or a path as the base a media id is appended to [spec: media/base-url-shape]', () => {
    expect(getMediaBaseUrl({ MEDIA_BASE_URL: 'https://images.example.com' })).toBe('https://images.example.com')
    expect(getMediaBaseUrl({ MEDIA_BASE_URL: '/v1/media' })).toBe('/v1/media')
  })

  it('fails on a missing, empty, or trailing-slash base instead of defaulting', () => {
    for (const MEDIA_BASE_URL of ['', 'https://images.example.com/', '/v1/media/', 'images.example.com']) {
      expect(() => getMediaBaseUrl({ MEDIA_BASE_URL })).toThrow('Invalid media configuration')
    }
    expect(() => getMediaBaseUrl({} as { MEDIA_BASE_URL: string })).toThrow('Invalid media configuration')
  })
})
