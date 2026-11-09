import type { FactDto } from '@shared/facts'

const labels = (...values: Array<string | undefined>) => values.filter((value) => value !== undefined).join(', ')

/** One line describing what a fact claims, for lists. */
export function summarizeFact(fact: FactDto): string {
  switch (fact.kind) {
    case 'entry':
      return ''
    case 'sense':
      return fact.payload.register ? `${fact.payload.gloss} (${fact.payload.register})` : fact.payload.gloss
    case 'form':
      return `${fact.payload.form} (${labels(fact.payload.type, fact.payload.pos)})`
    case 'relation':
      return `${fact.payload.type} → sense ${fact.payload.target_sense_id.slice(0, 8)}`
    case 'pronunciation':
      return `/${fact.payload.ipa}/ (${labels(fact.payload.accent, fact.payload.strength, fact.payload.pos)})`
    case 'example':
      return fact.payload.text
    case 'translation':
      return `${fact.payload.language}: ${fact.payload.text}`
    case 'topic':
      return fact.payload.topic_id
  }
}
