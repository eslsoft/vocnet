import { type ClientConfig, clientConfigSchema } from '@shared/types'
import { decodeApiResponse, rpc } from '@/shared/api/client'

// The SPA's runtime config comes from the backend (GET /api/configz), so there is
// one set of env vars (on the worker) and the same bundle runs in every environment.
let config: ClientConfig | null = null

export async function loadConfig(): Promise<ClientConfig> {
  const response = await rpc.configz.$get()
  config = await decodeApiResponse(response, clientConfigSchema)
  return config
}

export function getConfig(): ClientConfig {
  if (!config) throw new Error('Config not loaded — call loadConfig() at startup.')
  return config
}
