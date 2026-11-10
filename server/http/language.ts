import { negotiateLanguage, servedLanguage } from '@server/domain/language'
import type { ReadVariant } from '@server/domain/public-view'
import { languageTagSchema } from '@shared/catalog'
import type { Context } from 'hono'

/**
 * The language tags of an Accept-Language header from most to least preferred: by quality, the
 * first of equals first. `*`, ranges with quality 0, and ranges that are not language tags are left out.
 */
export function acceptedLanguages(header: string | undefined): string[] {
  const ranges = (header ?? '').split(',').flatMap((part) => {
    const [tag = '', ...params] = part.split(';').map((piece) => piece.trim())
    const quality = params.find((param) => /^q=/i.test(param))
    const q = quality === undefined ? 1 : Number(quality.slice(2))
    return tag !== '*' && q > 0 && languageTagSchema.safeParse(tag).success ? [{ tag, q }] : []
  })
  return ranges.sort((a, b) => b.q - a.q).map((range) => range.tag)
}

/**
 * The variant a public read asks for. `?lang=` wins over Accept-Language: `all` (in any case) for
 * every language, else the served language the tag reads, or none. Without it, the most preferred
 * Accept-Language tag that reads a served language. `?include=review` adds review metadata. The body
 * depends on Accept-Language, so the response varies by it.
 */
export function readVariant(c: Context, query: { lang?: string; include?: 'review' }): ReadVariant {
  c.header('Vary', 'Accept-Language')
  const lang =
    query.lang === undefined
      ? negotiateLanguage(acceptedLanguages(c.req.header('accept-language')))
      : query.lang.toLowerCase() === 'all'
        ? 'all'
        : servedLanguage(query.lang)
  return { lang, review: query.include === 'review' }
}
