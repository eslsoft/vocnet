import type { ReferenceSource } from '@shared/reference'
import { HttpResponse, http } from 'msw'

// The public dictionary API (/v1) at the network edge, for the public site's component tests.

export const sources: ReferenceSource[] = [
  {
    id: 'wordfreq-3.1.1',
    name: 'wordfreq',
    version: '3.1.1',
    license: 'CC BY-SA 4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    changes: 'Kept the English list.',
    attribution: 'Word frequencies from wordfreq by Robyn Speer.',
    url: 'https://github.com/rspeer/wordfreq',
    retrieved_at: '2026-11-09',
  },
]

export function apiError(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status })
}

export const sourcesHandler = (items: ReferenceSource[] | null = sources) =>
  http.get('/v1/sources', () =>
    items ? HttpResponse.json({ items }) : apiError(429, 'rate_limited', 'Sources are unavailable.'),
  )
