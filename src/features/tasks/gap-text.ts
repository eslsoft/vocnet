import type { Gap } from '@shared/work'
import type { TFunction } from 'i18next'

/** What a task is missing, in plain words an admin reads without knowing the gap rules. */
export function gapText(gap: Gap, t: TFunction): string {
  switch (gap.type) {
    case 'senses':
    case 'phrases':
    case 'family':
    case 'morphology':
    case 'syllables':
    case 'category':
    case 'parts':
    case 'synonyms':
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
    case 'form_pronunciations':
      return t('gap.form_pronunciations', { forms: gap.forms.join(', ') })
    case 'examples':
      return t('gap.examples', { count: gap.count, need: gap.need })
    case 'translations':
      return t('gap.translations', { count: gap.missing.length })
    case 'sayings':
      return t('gap.sayings', { count: gap.missing.length })
  }
}

/** The short form shown inline where the missing fact would go: what is still needed. */
export function gapNeed(gap: Gap, t: TFunction): string {
  if (gap.type === 'examples') return t('gapNeed.examples', { count: gap.need - gap.count })
  return gapText(gap, t)
}
