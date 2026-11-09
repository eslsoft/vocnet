import { ReviewerProtocolError, ReviewerTransportError } from '@server/usecases/ports'

export interface ModelGatewayConfig {
  baseUrl: string
  apiKey: string
}

/** POSTs JSON to the model gateway. Network failures, 429, and 5xx are transport errors; other non-2xx are protocol errors. */
export async function postJson(config: ModelGatewayConfig, path: string, body: unknown): Promise<unknown> {
  const url = new URL(path, `${config.baseUrl.replace(/\/$/, '')}/`)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (cause) {
    throw new ReviewerTransportError(`Model gateway request to ${url.pathname} failed.`, { cause })
  }
  if (response.status === 429 || response.status >= 500) {
    throw new ReviewerTransportError(`Model gateway ${url.pathname} answered ${response.status}.`)
  }
  if (!response.ok) {
    throw new ReviewerProtocolError(`Model gateway ${url.pathname} rejected the request with ${response.status}.`)
  }
  try {
    return await response.json()
  } catch (cause) {
    throw new ReviewerProtocolError(`Model gateway ${url.pathname} returned malformed JSON.`, { cause })
  }
}
