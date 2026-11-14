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
 * other non-2xx are protocol errors. Every call logs its model, status, and duration, body
 * included: the gateway queues a call that its upstream rate-limits, so a limit shows as latency.
 */
export async function postJson(
  config: ModelGatewayConfig,
  path: string,
  body: { model: string; [field: string]: unknown },
  timeoutMs = GATEWAY_TIMEOUT_MS,
): Promise<unknown> {
  const url = new URL(path, `${config.baseUrl.replace(/\/$/, '')}/`)
  const controller = new AbortController()
  const { signal } = controller
  // The deadline settles the call itself: the local runtime let gateway calls run past an abort
  // signal's timeout (191 s against 120 s), and one call that never answered held its review batch,
  // and with it the queue, forever.
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const reason = new DOMException(`Model gateway ${url.pathname} timed out.`, 'TimeoutError')
      controller.abort(reason)
      reject(reason)
    }, timeoutMs)
  })
  const withinDeadline = <T>(work: Promise<T>) => Promise.race([work, deadline])
  try {
    return await call()
  } finally {
    clearTimeout(timer)
  }

  async function call(): Promise<unknown> {
    const started = Date.now()
    const logCall = (status: number | 'network') =>
      console.info(
        JSON.stringify({
          event: 'gateway_call',
          path: url.pathname,
          model: body.model,
          status,
          durationMs: Date.now() - started,
        }),
      )
    let response: Response
    try {
      response = await withinDeadline(
        fetch(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        }),
      )
    } catch (cause) {
      logCall('network')
      throw new ReviewerTransportError(`Model gateway request to ${url.pathname} failed.`, { cause })
    }
    if (!response.ok) logCall(response.status)
    if (response.status === 429 || response.status >= 500) {
      throw new ReviewerTransportError(`Model gateway ${url.pathname} answered ${response.status}.`)
    }
    if (!response.ok) {
      throw new ReviewerProtocolError(`Model gateway ${url.pathname} rejected the request with ${response.status}.`)
    }
    try {
      const json = await withinDeadline(response.json())
      logCall(response.status)
      return json
    } catch (cause) {
      logCall(response.status)
      if (isTimeout(cause)) throw new ReviewerTransportError(`Model gateway ${url.pathname} timed out.`, { cause })
      throw new ReviewerProtocolError(`Model gateway ${url.pathname} returned malformed JSON.`, { cause })
    }
  }
}
