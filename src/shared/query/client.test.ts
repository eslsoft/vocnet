import { describe, expect, it } from 'vitest'
import { ApiClientError, ApiProtocolError } from '@/shared/api/client'
import { shouldRetry } from './client'

describe('query retry policy', () => {
  it('never retries a 4xx answer', () => {
    for (const status of [400, 401, 403, 404, 409]) {
      expect(shouldRetry(0, new ApiClientError(status, 'code', 'message'))).toBe(false)
    }
  })

  it('retries 5xx, network, and protocol failures three times', () => {
    for (const error of [
      new ApiClientError(503, 'unavailable', 'down'),
      new TypeError('Failed to fetch'),
      new ApiProtocolError('malformed'),
    ]) {
      expect([0, 1, 2, 3].map((count) => shouldRetry(count, error))).toEqual([true, true, true, false])
    }
  })
})
