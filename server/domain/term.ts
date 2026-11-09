export type Lemma = string & { readonly __brand: 'Lemma' }

/** Canonical spelling of a headword or form: NFC, trimmed, single spaces. Case is meaningful. */
export function normalizeTerm(raw: string): Lemma {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ') as Lemma
}

/** Dedupe key for free text: the canonical term, case-folded. */
export function textKey(raw: string): string {
  return normalizeTerm(raw).toLowerCase()
}
