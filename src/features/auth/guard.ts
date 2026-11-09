import { redirect } from 'react-router'
import { isAuthenticated } from './oidc'

// Route loader that gates the authenticated subtree (see app/router).
export function requireAuthLoader() {
  return isAuthenticated() ? null : redirect('/login')
}
