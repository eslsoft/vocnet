import type { Pos } from '@shared/facts'
import { type CefrLevel, cefrLevelSchema } from '@shared/reference'
import { type Lemma, normalizeTerm } from './term'

// The rules that turn the external datasets into reference rows. The offline generator in
// scripts/reference/ runs them; the server only reads their output.

/** A row as a CEFR vocabulary profile lists it. */
export interface CefrSourceRow {
  headword: string
  pos: string
  level: string
}

export interface CefrRow {
  lemma: Lemma
  pos: Pos
  level: CefrLevel
  sourceId: string
}

export interface FrequencyRow {
  /** The frequency key of the word form; see `frequencyKey`. */
  word: string
  zipf: number
  rank: number
}

/** How a profile's POS labels map onto ours: a POS, or null for labels with no lexical entry. */
export type PosMap = Readonly<Record<string, Pos | null>>

const lexicalPos = {
  noun: 'noun',
  verb: 'verb',
  adjective: 'adjective',
  adverb: 'adverb',
  pronoun: 'pronoun',
  determiner: 'determiner',
  preposition: 'preposition',
  conjunction: 'conjunction',
  interjection: 'interjection',
} as const satisfies PosMap

/** CEFR-J lists auxiliaries by verb, and numbers and infinitive "to" as their own classes. */
export const cefrjPos: PosMap = {
  ...lexicalPos,
  'modal auxiliary': 'auxiliary',
  'be-verb': 'auxiliary',
  'do-verb': 'auxiliary',
  'have-verb': 'auxiliary',
  number: null,
  'infinitive-to': null,
}

/** Octanove misspells one verb label; an unlabeled row cannot be keyed by part of speech. */
export const octanovePos: PosMap = { ...lexicalPos, vern: 'verb', '': null }

/** A headword cell may list spelling variants separated by "/"; each is a lemma of its own. */
export function headwords(cell: string): Lemma[] {
  return cell
    .split('/')
    .map(normalizeTerm)
    .filter((lemma) => lemma.length > 0)
}

// CEFR levels sort as strings: A1 < A2 < B1 < B2 < C1 < C2.
const lower = (a: CefrLevel, b: CefrLevel) => (a < b ? a : b)

/**
 * A headword the core import makes an entry: any but a single letter, which names the letter
 * rather than a word, except "a" and "I".
 */
export const isCoreHeadword = (lemma: string) => !/^\p{L}$/u.test(lemma) || lemma === 'a' || lemma === 'I'

/** A level's place in learning order: 1 for A1 to 6 for C2. */
export const levelRank = (level: CefrLevel) => cefrLevelSchema.options.indexOf(level) + 1

/**
 * One level per (lemma, POS). A source that lists a pair several times (once per sense) gives
 * it its lowest level, and an earlier source in `sources` wins over a later one. A POS label
 * missing from the source's map fails, so a new label is mapped on purpose, never dropped.
 */
export function mergeCefr(sources: ReadonlyArray<{ id: string; pos: PosMap; rows: CefrSourceRow[] }>): CefrRow[] {
  const merged = new Map<string, CefrRow>()
  for (const source of sources) {
    const own = new Map<string, CefrRow>()
    for (const row of source.rows) {
      const label = row.pos.trim()
      if (!Object.hasOwn(source.pos, label)) throw new Error(`${source.id}: unknown POS ${JSON.stringify(row.pos)}.`)
      const pos = source.pos[label]
      if (!pos) continue
      const level = cefrLevelSchema.parse(row.level.trim())
      for (const lemma of headwords(row.headword)) {
        const key = `${lemma}\u0000${pos}`
        const seen = own.get(key)
        own.set(key, { lemma, pos, level: seen ? lower(seen.level, level) : level, sourceId: source.id })
      }
    }
    for (const [key, row] of own) {
      if (!merged.has(key)) merged.set(key, row)
    }
  }
  return [...merged.values()]
}

/**
 * The one key a lemma's frequency is stored and read under: its lowercase spelling. wordfreq
 * case-folds every form it counts, so "May" and "may" are one word form with one frequency,
 * shared by every capitalization. This is the key space of the source, not a retry under
 * another spelling: each lemma has exactly one key. JavaScript lowercases where wordfreq's
 * Python casefolds; the two differ only outside English (German "ß" folds to "ss").
 */
export function frequencyKey(lemma: string): string {
  return lemma.toLowerCase()
}

/**
 * A word form the frequency list can key a lemma by: one token of letters, combining marks,
 * apostrophes, and periods ("o'clock", "a.m."). Markup, handles, and emoji residue ("info@",
 * "cs:go", "size_t", a letter with a variation selector) are not words.
 */
export function isWordForm(form: string): boolean {
  return /^[\p{L}\p{M}'.]+$/u.test(form) && /\p{L}/u.test(form) && !/\p{Variation_Selector}/u.test(form)
}

/**
 * Keeps the word forms, ranked by Zipf: a form's rank is one plus the number of word forms
 * above it, so equal values share a rank. Two forms with one key fail, since neither value
 * could be chosen on principle.
 */
export function rankFrequencies(forms: ReadonlyArray<{ form: string; zipf: number }>): FrequencyRow[] {
  const zipfs = new Map<string, number>()
  for (const { form, zipf } of forms) {
    if (!isWordForm(form)) continue
    const word = frequencyKey(normalizeTerm(form))
    if (zipfs.has(word)) throw new Error(`Two frequency forms have the key ${JSON.stringify(word)}.`)
    zipfs.set(word, zipf)
  }
  const sorted = [...zipfs].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
  const rows: FrequencyRow[] = []
  let previous: FrequencyRow | undefined
  for (const [index, [word, zipf]] of sorted.entries()) {
    previous = { word, zipf, rank: previous?.zipf === zipf ? previous.rank : index + 1 }
    rows.push(previous)
  }
  return rows
}
