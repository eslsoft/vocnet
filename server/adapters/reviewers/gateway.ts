import { ReviewerProtocolError, ReviewerTransportError } from '@server/usecases/ports'

export interface ModelGatewayConfig {
  baseUrl: string
  apiKey: string
}

/**
 * How long one gateway call may take, body included. A review batch waits for its slowest call, so a
 * call that never answers stalled every review behind it; past this it is a transport failure the
 * queue retries.
 */
export const GATEWAY_TIMEOUT_MS = 120_000

const isTimeout = (cause: unknown) =>
  cause instanceof DOMException && (cause.name === 'TimeoutError' || cause.name === 'AbortError')

/**
 * POSTs JSON to the model gateway. Network failures, timeouts, 429, and 5xx are transport errors;
 * other non-2xx are protocol errors.
 */
export async function postJson(
  config: ModelGatewayConfig,
  path: string,
  body: unknown,
  timeoutMs = GATEWAY_TIMEOUT_MS,
): Promise<unknown> {
  const url = new URL(path, `${config.baseUrl.replace(/\/$/, '')}/`)
  const signal = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
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
    if (isTimeout(cause)) throw new ReviewerTransportError(`Model gateway ${url.pathname} timed out.`, { cause })
    throw new ReviewerProtocolError(`Model gateway ${url.pathname} returned malformed JSON.`, { cause })
  }
}
