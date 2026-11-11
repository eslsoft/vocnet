import type { PublicExample, PublicGrammar, PublicSense } from '@shared/catalog'

// How a learner's dictionary writes the grammar of a sense: short codes in brackets and the
// patterns that follow the word, with ~ standing for the headword.

const PATTERNS: Record<string, string> = {
  to_infinitive: '~ to do',
  bare_infinitive: '~ do',
  ing_form: '~ doing',
  that_clause: '~ that…',
  wh_clause: '~ wh-…',
  object_to_infinitive: '~ sb to do',
  object_bare_infinitive: '~ sb do',
  object_ing: '~ sb doing',
  two_objects: '~ sb sth',
  object_complement: '~ sth + complement',
  of_ing: '~ of doing',
}

const CODES: Record<string, string> = {
  countable: 'countable',
  uncountable: 'uncountable',
  both: 'countable, uncountable',
  plural_only: 'plural',
  singular_only: 'singular',
  transitive: 'transitive',
  intransitive: 'intransitive',
  attributive_only: 'only before noun',
  predicative_only: 'not before noun',
  with_the: 'usually the',
  zero_article: 'no article',
  front: 'front position',
  mid: 'mid position',
  end: 'end position',
  singular_noun: 'singular noun',
  plural_noun: 'plural noun',
  uncountable_noun: 'uncountable noun',
  of_plural: 'of + plural',
  singular_verb: 'singular verb',
  plural_verb: 'plural verb',
}

const words = (value: string) => CODES[value] ?? value.replaceAll('_', ' ')

/** The bracketed codes of a sense, such as "countable" or "transitive, intransitive". */
export function grammarCodes(grammar: PublicGrammar): string[] {
  const codes: string[] = []
  if (grammar.countability) codes.push(words(grammar.countability))
  if (grammar.number) codes.push(words(grammar.number))
  if (grammar.article) codes.push(words(grammar.article))
  if (grammar.transitivity) {
    codes.push(grammar.transitivity === 'both' ? 'transitive, intransitive' : words(grammar.transitivity))
  }
  if (grammar.position && grammar.position !== 'both') codes.push(words(grammar.position))
  if (grammar.agreement) codes.push(`with ${grammar.agreement.map(words).join(', ')}`)
  return codes
}

/** The constructions that follow the word, prepositions included. */
export function grammarPatterns(grammar: PublicGrammar): string[] {
  return [
    ...grammar.patterns.map((pattern) => PATTERNS[pattern] ?? `~ ${words(pattern)}`),
    ...grammar.prepositions.map((preposition) => `~ ${preposition}`),
  ]
}

/** Five frequency bands from the Zipf value: 1 is rare, 5 is core vocabulary. */
export function frequencyBand(zipf: number): 1 | 2 | 3 | 4 | 5 {
  if (zipf >= 6) return 5
  if (zipf >= 5) return 4
  if (zipf >= 4) return 3
  if (zipf >= 3) return 2
  return 1
}

/** A JSON path as jq writes it: .meanings[0].senses[2]. */
export function jqPath(path: ReadonlyArray<string | number>): string {
  return path.map((step) => (typeof step === 'number' ? `[${step}]` : `.${step}`)).join('') || '.'
}

/** The part of a JSON value at a path. */
export function sliceAt(value: unknown, path: ReadonlyArray<string | number>): unknown {
  return path.reduce<unknown>((node, step) => (node as Record<string | number, unknown>)[step], value)
}

/** The element id of a sense on the entry page, which relation links point at. */
export const senseAnchor = (senseId: string) => `sense-${senseId}`

/** Where a word's entry page is, optionally at one of its senses. */
export function wordPath(lemma: string, senseId?: string): string {
  const path = `/words/${encodeURIComponent(lemma)}`
  return senseId ? `${path}#${senseAnchor(senseId)}` : path
}

/** Translations arrive as a list in the asked language, or keyed by language with lang=all. */
export function translationList(value: PublicSense['translations']): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : Object.values(value).flat()
}

export function exampleTranslation(value: PublicExample['translation']): string | undefined {
  return value === undefined || typeof value === 'string' ? value : Object.values(value).join('；')
}
