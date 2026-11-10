import type { SearchMatch } from '@shared/catalog'

// Search over the public view. The index stores, per text of a public sense, the words an FTS5
// `unicode61` tokenizer splits. That tokenizer splits on spaces and punctuation, but CJK text has
// none between words, so a run of CJK characters is indexed as its single characters and every
// overlapping pair of them: "银行业" as 银 行 业 银行 行业. A query looks up a run by its pairs, so
// "银行" matches every text that holds those two characters side by side; a single character is
// looked up as itself. Latin text is left to the tokenizer, which folds case and diacritics.

const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu
const WORD = /[\p{L}\p{M}\p{N}]+/gu

/** The fields of a public sense a search matches, in rank order after the lemma. */
export const SEARCH_FIELDS = ['gloss', 'translation', 'example'] as const satisfies readonly SearchMatch[]
export type SearchField = (typeof SEARCH_FIELDS)[number]

/**
 * A hit's rank, lowest first: the exact lemma, then a lemma that starts with the query, then a
 * gloss, a translation, and an example that holds every word of it.
 */
export const SEARCH_TIERS: readonly SearchMatch[] = ['lemma', 'lemma', ...SEARCH_FIELDS]
export const EXACT_LEMMA_TIER = 0
export const LEMMA_PREFIX_TIER = 1
export const fieldTier = (field: SearchField) => LEMMA_PREFIX_TIER + 1 + SEARCH_FIELDS.indexOf(field)

const pairs = (run: string) => {
  const chars = [...run]
  return chars.slice(1).map((char, at) => `${chars[at]}${char}`)
}

/** The text as the index stores it: every CJK run spelled out as its characters and their pairs. */
export function searchBody(text: string): string {
  return text.replace(CJK_RUN, (run) => ` ${[...new Set([...run, ...pairs(run)])].join(' ')} `)
}

/**
 * The terms a query must all match: each word of Latin text, and each CJK run as its pairs (a
 * one-character run as itself). Empty when the query has no letter or digit.
 */
export function searchTerms(query: string): string[] {
  const terms = query.split(CJK_RUN).flatMap((latin) => latin.match(WORD) ?? [])
  for (const [run] of query.matchAll(CJK_RUN)) terms.push(...([...run].length === 1 ? [run] : pairs(run)))
  return [...new Set(terms)]
}
