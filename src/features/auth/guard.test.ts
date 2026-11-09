import { afterEach, describe, expect, it } from 'vitest'
import { clearAccessToken, setAccessToken } from '@/shared/api/client'
import { requireAuthLoader } from './guard'

describe('requireAuthLoader', () => {
  afterEach(() => clearAccessToken())

  it('redirects to /login when unauthenticated', () => {
    const result = requireAuthLoader()
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(302)
    expect((result as Response).headers.get('location')).toBe('/login')
  })

  it('passes through when authenticated', () => {
    setAccessToken('t')
    expect(requireAuthLoader()).toBeNull()
  })
})
