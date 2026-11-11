// Try it calls the public API from the browser exactly as a client would, and keeps what the wire
// said: the status, the headers a client acts on, the time, and the body as sent.

const SHOWN_HEADERS = ['content-type', 'cache-control', 'etag', 'vary', 'retry-after']

export interface TryResult {
  status: number
  statusText: string
  durationMs: number
  headers: Array<[string, string]>
  /** The parsed JSON body; undefined when the body is not JSON. */
  json: unknown
  text: string
}

export async function sendRequest(method: 'GET' | 'POST', path: string): Promise<TryResult> {
  const started = performance.now()
  const response = await fetch(path, { method, headers: { accept: 'application/json' } })
  const text = await response.text()
  const durationMs = Math.round(performance.now() - started)
  const json = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : undefined
  return {
    status: response.status,
    statusText: response.statusText,
    durationMs,
    headers: SHOWN_HEADERS.flatMap((name) => {
      const value = response.headers.get(name)
      return value === null ? [] : [[name, value] as [string, string]]
    }),
    json,
    text,
  }
}
