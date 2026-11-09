import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAccessToken, getAccessToken, setAccessToken } from '@/shared/api/client'

const signinRedirect = vi.fn()
const signinRedirectCallback = vi.fn()
const removeUser = vi.fn()

vi.mock('oidc-client-ts', () => ({
  // Classes (not arrow fns) so `new UserManager(...)` in the module under test works.
  UserManager: class {
    signinRedirect = signinRedirect
    signinRedirectCallback = signinRedirectCallback
    removeUser = removeUser
  },
  WebStorageStateStore: class {},
  InMemoryWebStorage: class {},
}))
vi.mock('@/shared/config', () => ({
  getConfig: () => ({ oidc: { issuer: 'https://issuer.test', clientId: 'c' } }),
}))

import { completeLogin, isAuthenticated, login, logout } from './oidc'

describe('auth/oidc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearAccessToken()
  })

  it('isAuthenticated reflects the in-memory access token', () => {
    expect(isAuthenticated()).toBe(false)
    setAccessToken('t')
    expect(isAuthenticated()).toBe(true)
  })

  it('login triggers the provider redirect', async () => {
    await login()
    expect(signinRedirect).toHaveBeenCalledOnce()
  })

  it('completeLogin stores only the access token', async () => {
    signinRedirectCallback.mockResolvedValue({ id_token: 'jwt', access_token: 'a' })
    await completeLogin()
    expect(getAccessToken()).toBe('a')
  })

  it('completeLogin rejects a callback without an access token', async () => {
    signinRedirectCallback.mockResolvedValue({})
    await expect(completeLogin()).rejects.toThrow('access token')
    expect(getAccessToken()).toBeNull()
  })

  it('logout clears the token and removes the user', async () => {
    setAccessToken('t')
    await logout()
    expect(getAccessToken()).toBeNull()
    expect(removeUser).toHaveBeenCalledOnce()
  })
})
