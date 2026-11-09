export type Lemma = string & { readonly __brand: 'Lemma' }

/** Canonical spelling of a headword or form: NFC, trimmed, single spaces. Case is meaningful. */
export function normalizeTerm(raw: string): Lemma {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ') as Lemma
}

/** A lemma of more than one word: a phrase, admitted only as a lexical unit. */
export const isMultiword = (lemma: string) => /\s/.test(lemma)

/** Dedupe key for free text: the canonical term, case-folded. */
export function textKey(raw: string): string {
  return normalizeTerm(raw).toLowerCase()
}

/** Levenshtein distance: the fewest single-letter insertions, deletions, or substitutions from a to b. */
export function editDistance(a: string, b: string): number {
  const target = [...b]
  let previous = Array.from({ length: target.length + 1 }, (_, at) => at)
  for (const [i, letter] of [...a].entries()) {
    const row = [i + 1]
    for (const [j, other] of target.entries()) {
      row.push(Math.min(previous[j + 1] + 1, row[j] + 1, previous[j] + (letter === other ? 0 : 1)))
    }
    previous = row
  }
  return previous[target.length]
}
