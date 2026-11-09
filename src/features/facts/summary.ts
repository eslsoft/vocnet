import type { FactDto } from '@shared/facts'

/** One line describing what a fact claims, for lists. */
export function summarizeFact(fact: FactDto): string {
  switch (fact.kind) {
    case 'entry':
      return ''
    case 'sense':
      return fact.payload.gloss
    case 'form':
      return `${fact.payload.form} (${fact.payload.type})`
    case 'relation':
      return `${fact.payload.type} → sense ${fact.payload.target_sense_id.slice(0, 8)}`
    case 'pronunciation':
      return `/${fact.payload.ipa}/ (${fact.payload.accent})`
    case 'example':
      return fact.payload.text
    case 'translation':
      return `${fact.payload.language}: ${fact.payload.text}`
  }
}
