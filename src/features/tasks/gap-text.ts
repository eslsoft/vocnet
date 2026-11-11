import type { Gap } from '@shared/work'
import type { TFunction } from 'i18next'

/** What a task is missing, in plain words an admin reads without knowing the gap rules. */
export function gapText(gap: Gap, t: TFunction): string {
  switch (gap.type) {
    case 'senses':
    case 'sense_list':
    case 'family':
    case 'morphology':
    case 'syllables':
    case 'category':
    case 'parts':
    case 'synonyms':
    case 'translations':
    case 'topics':
    case 'grammar':
    case 'collocations':
      return t(`gap.${gap.type}`)
    case 'forms':
      return t('gap.forms', {
        forms: gap.missing.map((slot) => `${t(`entry.forms.${slot.type}`)} (${t(`pos.${slot.pos}`)})`).join(', '),
      })
    case 'pronunciation':
      return t('gap.pronunciation', { accents: gap.accents.map((accent) => t(`accent.${accent}`)).join(', ') })
    case 'phrases':
      return t('gap.phrases', { count: gap.have.length, need: gap.need })
    case 'form_pronunciations':
      return t('gap.form_pronunciations', { forms: gap.forms.join(', ') })
    case 'examples':
      return t('gap.examples', { count: gap.count, need: gap.need })
    case 'example_translations':
      return t('gap.example_translations', { count: gap.examples.length })
    case 'weak_fact':
      return t(`gap.weak_fact.${gap.reason}`, { kind: t(`factKind.${gap.kind}`) })
  }
}

/** The short form shown inline where the missing fact would go: what is still needed. */
export function gapNeed(gap: Gap, t: TFunction): string {
  if (gap.type === 'examples') return t('gapNeed.examples', { count: gap.need - gap.count })
  if (gap.type === 'phrases') return t('gapNeed.phrases', { count: gap.need - gap.have.length })
  return gapText(gap, t)
}
