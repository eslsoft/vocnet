import { publicEntrySchema, searchPageSchema } from '@shared/catalog'
import type { RelationDomain } from '@shared/facts'
import { referenceSourceListSchema } from '@shared/reference'
import { decodeApiPayload, decodeApiResponse, rpc } from '@/shared/api/client'

// The public dictionary reads (/v1). They need no credential, so they work signed out. Learners
// here read Chinese, so translations are asked for in zh.
export const TRANSLATION_LANGUAGE = 'zh'

/** The path and query of a public read, as the page shows it in its API panels; every read names its language. */
export function readPath(path: string, query: Record<string, string | undefined>): string {
  const params = new URLSearchParams(
    Object.entries(query).filter((pair): pair is [string, string] => pair[1] !== undefined),
  )
  return `${path}?${params}`
}

export function entryQuery(domain: RelationDomain | undefined) {
  return { lang: TRANSLATION_LANGUAGE, domain }
}

/** One entry with the JSON it was read from, so each block can show its slice of the wire. */
export async function getEntry(lemma: string, domain: RelationDomain | undefined) {
  const response = await rpc.v1.entries[':lemma'].$get({ param: { lemma }, query: entryQuery(domain) })
  const { data, payload } = await decodeApiPayload(response, publicEntrySchema)
  return {
    entry: data,
    payload,
    path: readPath(`/v1/entries/${encodeURIComponent(lemma)}`, entryQuery(domain)),
  }
}

export async function searchEntries(q: string, limit: number) {
  const response = await rpc.v1.search.$get({
    query: { q, limit: String(limit), lang: TRANSLATION_LANGUAGE },
  })
  return decodeApiResponse(response, searchPageSchema)
}

export async function listSources() {
  return decodeApiResponse(await rpc.v1.sources.$get(), referenceSourceListSchema)
}
