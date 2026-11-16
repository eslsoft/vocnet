import type { FactDto } from '@shared/facts'

const labels = (...values: Array<string | undefined>) => values.filter((value) => value !== undefined).join(', ')

/** One line describing what a fact claims, for lists. */
export function summarizeFact(fact: FactDto): string {
  switch (fact.kind) {
    case 'senses': {
      const common = fact.payload.senses.filter((sense) => sense.rank === 'common').length
      return `${common} common, ${fact.payload.senses.length - common} extra`
    }
    case 'form': {
      const { form, type, pos, ipa, accent } = fact.payload
      return `${form} (${labels(type, pos)})${ipa ? ` /${ipa}/ (${accent})` : ''}`
    }
    case 'relation':
      return `${fact.payload.type} → sense ${fact.payload.target_sense_id.slice(0, 8)}`
    case 'pronunciation':
      return `/${fact.payload.ipa}/ (${labels(fact.payload.accent, fact.payload.strength, fact.payload.pos)})`
    case 'example':
      return fact.payload.text ?? `sentence ${fact.payload.sentence_id.slice(0, 8)}`
    case 'translation':
      return `${fact.payload.language} (${fact.payload.of}): ${fact.payload.text}`
    case 'topic':
      return fact.payload.topic_id
    case 'grammar': {
      const { countability, number, article, transitivity, position, agreement, patterns, prepositions } = fact.payload
      return labels(
        countability,
        number,
        article,
        transitivity,
        position,
        ...(agreement ?? []),
        ...(patterns ?? []),
        ...(prepositions ?? []),
      )
    }
    case 'morphology': {
      const { parts, shortened } = fact.payload
      const formation = parts
        .map(({ form, meaning, lemma }) => `${form}${meaning ? ` "${meaning}"` : ''}${lemma ? ` → ${lemma}` : ''}`)
        .join(' + ')
      return shortened ? `${formation} (${shortened.type} of ${shortened.of})` : formation
    }
    case 'collocation':
      return `${fact.payload.text} (${fact.payload.pattern})`
    case 'syllables':
      return fact.payload.syllables.join('·')
    case 'phrases':
      return fact.payload.phrases
        .map(
          (item) =>
            `${item.text ?? (item.type === 'saying' ? item.sentence_id : item.entry_id).slice(0, 8)} (${item.type})`,
        )
        .join(' · ')
    case 'sentence_meaning':
      return fact.payload.gloss
    case 'productive_use': {
      const { pos, native, learner } = fact.payload
      const use = (active: boolean) => (active ? 'active' : 'passive')
      return `${pos}: native ${use(native)}, learner ${use(learner)}`
    }
  }
}
