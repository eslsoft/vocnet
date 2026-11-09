import type { Principal } from '@server/domain/principal'
import type { Deps } from '@server/usecases/deps'

// The env vars the HTTP layer reads from context. Deliberately a plain interface
// (not Cloudflare.Env): it keeps the http layer, and the exported AppType used by
// the SPA's RPC client, free of Workers-only globals. The full Env (D1, queue,
// ASSETS) lives in composition/worker, which the frontend never imports.
export interface AppBindings {
  OIDC_ISSUER: string
  OIDC_CLIENT_ID: string
}

export interface AppVariables {
  deps: Deps
  principal: Principal
  authMethod: 'agent_key' | 'oidc'
  requestId: string
  traceId: string
  unexpectedError?: Error
}

export interface AppEnv {
  Bindings: AppBindings
  Variables: AppVariables
}
