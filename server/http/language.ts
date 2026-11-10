import type { ReadVariant } from '@server/domain/public-view'
import { languageTagSchema } from '@shared/catalog'
import type { Context } from 'hono'

/**
 * The most preferred language tag of an Accept-Language header: the range with the highest
 * quality, the first of equals. `*`, ranges with quality 0, and ranges that are not language tags
 * name no language. Null when none is left.
 */
export function preferredLanguage(header: string | undefined): string | null {
  const ranges = (header ?? '').split(',').flatMap((part) => {
    const [tag = '', ...params] = part.split(';').map((piece) => piece.trim())
    const quality = params.find((param) => /^q=/i.test(param))
    const q = quality === undefined ? 1 : Number(quality.slice(2))
    return tag !== '*' && q > 0 && languageTagSchema.safeParse(tag).success ? [{ tag, q }] : []
  })
  return (
    ranges.reduce<{ tag: string; q: number } | null>((best, range) => (best && best.q >= range.q ? best : range), null)
      ?.tag ?? null
  )
}

/**
 * The variant a public read asks for: `?lang=` wins over Accept-Language, and `?include=review`
 * adds review metadata. The body depends on Accept-Language, so the response varies by it.
 */
export function readVariant(c: Context, query: { lang?: string; include?: 'review' }): ReadVariant {
  c.header('Vary', 'Accept-Language')
  return {
    lang: query.lang ?? preferredLanguage(c.req.header('accept-language')),
    review: query.include === 'review',
  }
}
