// The language a public read is served in. A read names a language with a BCP 47 tag; the dataset
// stores translations under its own tags. A requested tag reads a stored one only when it names the
// same language in the same script, so no other language or script ever stands in for the one asked.

/**
 * The languages the dataset collects translations in (the worklist asks for zh) and so serves.
 * Every stored translation is tagged plain `zh` and is Simplified Chinese: in this dataset `zh`
 * means Simplified.
 */
export const SERVED_LANGUAGES: readonly string[] = ['zh']

// Chinese tags name a script explicitly (zh-Hans, zh-Hant) or imply one by region. Stored zh is
// Simplified, so only these requests read it; zh-Hant*, zh-TW, zh-HK, zh-MO and any other zh tag
// read nothing rather than Simplified text.
const SIMPLIFIED_CHINESE = /^zh(-hans(-[a-z0-9]{1,8})*|-cn|-sg)?$/
const REGION = /^([a-z]{2}|\d{3})$/

/**
 * Whether a requested tag reads translations stored under `stored`: Chinese by the script table
 * above; any other language when the tags are equal or the request only adds a region subtag (pt-BR
 * reads pt). A request never reads a longer tag, another script, or another language.
 */
export function readsLanguage(requested: string, stored: string): boolean {
  const request = requested.toLowerCase()
  const tag = stored.toLowerCase()
  if (tag === 'zh') return SIMPLIFIED_CHINESE.test(request)
  return request === tag || (request.startsWith(`${tag}-`) && REGION.test(request.slice(tag.length + 1)))
}

/** The served language a requested tag reads, or null when it reads none. */
export function servedLanguage(requested: string): string | null {
  return SERVED_LANGUAGES.find((served) => readsLanguage(requested, served)) ?? null
}

/** The served language of the first tag, in preference order, that reads one; null when none does. */
export function negotiateLanguage(preferred: readonly string[]): string | null {
  for (const tag of preferred) {
    const served = servedLanguage(tag)
    if (served) return served
  }
  return null
}
