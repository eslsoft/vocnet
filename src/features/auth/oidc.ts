import { InMemoryWebStorage, UserManager, WebStorageStateStore } from 'oidc-client-ts'
import { clearAccessToken, getAccessToken, setAccessToken } from '@/shared/api/client'
import { getConfig } from '@/shared/config'

let manager: UserManager | null = null

// Constructed lazily from the runtime config (GET /api/configz), so OIDC settings
// live only on the backend. Redirect transaction state survives the callback in
// sessionStorage; tokens stay in memory and disappear when the page is closed.
function getManager(): UserManager {
  if (!manager) {
    const { issuer, clientId } = getConfig().oidc
    manager = new UserManager({
      authority: issuer,
      client_id: clientId,
      redirect_uri: `${window.location.origin}/callback`,
      response_type: 'code',
      scope: 'openid profile email',
      stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
      userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    })
  }
  return manager
}

export function isAuthenticated(): boolean {
  return getAccessToken() !== null
}

export async function login(): Promise<void> {
  await getManager().signinRedirect()
}

export async function completeLogin(): Promise<void> {
  const user = await getManager().signinRedirectCallback()
  if (!user.access_token) throw new Error('OIDC callback did not return an access token.')
  setAccessToken(user.access_token)
}

export async function logout(): Promise<void> {
  clearAccessToken()
  await getManager().removeUser()
}
