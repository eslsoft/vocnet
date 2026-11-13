import { isLetterOfTheAlphabet, type Lemma } from './term'

// The filter a headword import applies before it admits anything: what a learner's dictionary
// never makes a headword, an inflection whose base is a headword, and the American spelling of a
// British one.

/** What an import knows of a lemma besides the candidates: whether it is an entry, and whether the reference list lists it. */
export interface ImportLookup {
  isEntry(lemma: string): boolean
  /** The reference CEFR list lists this spelling as a headword of its own. */
  listed(lemma: string): boolean
}

export interface HeadwordFilter {
  /** The candidates to admit, in their order. */
  admit: Lemma[]
  /** What each rule skipped. */
  skipped: {
    /** Single letters other than "a" and "I". */
    letters: Lemma[]
    /** Contractions and clitics ("'s", "'m", "'re", "can't"). */
    contractions: Lemma[]
    /** Lemmas with a character other than a letter, space, hyphen, or apostrophe. */
    characters: Lemma[]
    /** Regular inflections reduced to their base. */
    inflections: Array<{ lemma: Lemma; base: string }>
    /** American spellings merged into their British entry. */
    variants: Array<{ lemma: Lemma; of: string }>
  }
}

const CLITIC = /^['’]|['’](s|m|re|ve|ll|d)$|n['’]t$/i
const WORD_CHARACTERS = /^\p{L}[\p{L} '’-]*$/u

/** The bases a regular inflection could have: -s/-es/-ies, -ed/-ied, -ing, -er/-est, with a doubled or dropped letter. */
export function regularBases(lemma: string): string[] {
  const bases = new Set<string>()
  const add = (base: string) => {
    if (base.length < 2) return
    bases.add(base)
    // A doubled final consonant ("stopped", "bigger") and a dropped final e ("making", "later").
    if (/([b-df-hj-np-tv-z])\1$/.test(base)) bases.add(base.slice(0, -1))
    bases.add(`${base}e`)
  }
  for (const [suffix, replacement] of [
    ['ies', 'y'],
    ['ied', 'y'],
    ['ier', 'y'],
    ['iest', 'y'],
  ] as const) {
    if (lemma.endsWith(suffix)) bases.add(lemma.slice(0, -suffix.length) + replacement)
  }
  for (const suffix of ['es', 's', 'ed', 'd', 'ing', 'er', 'r', 'est', 'st']) {
    if (lemma.endsWith(suffix) && !(suffix === 's' && lemma.endsWith('ss'))) add(lemma.slice(0, -suffix.length))
  }
  bases.delete(lemma)
  return [...bases]
}

/**
 * The British spelling of an American one, by the pair rules -our/-or, -ise/-ize, -yse/-yze,
 * -re/-er, and -ogue/-og; null when no rule spells one. Guarded so a short word never pairs with
 * another word ("or" and "our", "floor" and "flour").
 */
export function britishSpelling(lemma: string): string | null {
  if (lemma.length >= 5 && /[^o]or$/.test(lemma)) return `${lemma.slice(0, -2)}our`
  if (lemma.length >= 5 && lemma.endsWith('ize')) return `${lemma.slice(0, -3)}ise`
  if (lemma.endsWith('yze')) return `${lemma.slice(0, -3)}yse`
  if (lemma.length >= 5 && /[b-df-hj-np-tv-z]er$/.test(lemma)) return `${lemma.slice(0, -2)}re`
  if (lemma.length >= 5 && lemma.endsWith('og')) return `${lemma}ue`
  return null
}

/**
 * Filters an import's candidates, in order: skips single letters, contractions and clitics, and
 * lemmas with other characters; reduces a regular inflection to its base when the base is a
 * candidate or an entry and the reference list does not list the form itself; and merges an
 * American spelling into its British one when that is a candidate or an entry.
 */
export function filterHeadwords(candidates: readonly Lemma[], lookup: ImportLookup): HeadwordFilter {
  const skipped: HeadwordFilter['skipped'] = {
    letters: [],
    contractions: [],
    characters: [],
    inflections: [],
    variants: [],
  }
  const words = candidates.filter((lemma) => {
    if (isLetterOfTheAlphabet(lemma)) skipped.letters.push(lemma)
    else if (CLITIC.test(lemma)) skipped.contractions.push(lemma)
    else if (!WORD_CHARACTERS.test(lemma)) skipped.characters.push(lemma)
    else return true
    return false
  })
  const candidate = new Set<string>(words)
  const present = (lemma: string) => candidate.has(lemma) || lookup.isEntry(lemma)
  const admit = words.filter((lemma) => {
    if (!lookup.listed(lemma)) {
      const base = regularBases(lemma).find(present)
      if (base) {
        skipped.inflections.push({ lemma, base })
        candidate.delete(lemma)
        return false
      }
    }
    const british = britishSpelling(lemma)
    if (british && present(british)) {
      skipped.variants.push({ lemma, of: british })
      candidate.delete(lemma)
      return false
    }
    return true
  })
  return { admit, skipped }
}
