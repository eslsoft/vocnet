import type { PublicEntry, WordSummary } from '@shared/catalog'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { type ApiSource, useApiPeek } from './api-peek'
import { exampleTranslation, phraseCount, wordPath } from './entry-format'

function WordLinks({ words }: { words: WordSummary[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {words.map((word) => (
        <li key={word.lemma}>
          <Link
            to={wordPath(word.lemma)}
            title={word.gloss ?? undefined}
            className="inline-flex rounded-md border px-2 py-0.5 text-sm hover:border-primary/50 hover:bg-accent hover:text-accent-foreground"
          >
            {word.lemma}
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** The headword's phrases: those filed under a sense, then by type, then its sayings. */
function PhraseGroups({ entry }: { entry: PublicEntry }) {
  const { t } = useTranslation()
  const { phrases } = entry
  // The read files a phrase under a sense only when the entry shows that sense.
  const glosses = new Map(entry.meanings.flatMap((meaning) => meaning.senses.map((sense) => [sense.id, sense.gloss])))
  const groups = [
    ...phrases.by_sense.map((group) => ({
      key: group.sense_id,
      title: glosses.get(group.sense_id),
      words: group.phrases,
    })),
    { key: 'phrasal_verbs', title: t('entry.phraseGroups.phrasalVerbs'), words: phrases.phrasal_verbs },
    { key: 'idioms', title: t('entry.phraseGroups.idioms'), words: phrases.idioms },
    { key: 'compounds', title: t('entry.phraseGroups.compounds'), words: phrases.compounds },
  ].filter((group) => group.words.length > 0)
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1.5">
          <h3 className="text-muted-foreground text-xs uppercase tracking-wide">{group.title}</h3>
          <WordLinks words={group.words} />
        </div>
      ))}
      {phrases.sayings.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-muted-foreground text-xs uppercase tracking-wide">{t('entry.phraseGroups.sayings')}</h3>
          <ul className="flex flex-col gap-2">
            {phrases.sayings.map((saying) => (
              <li key={saying.sentence_id} className="border-border border-l-2 pl-3">
                <p className="text-foreground/90 italic">{saying.text}</p>
                {saying.meaning ? <p className="text-sm">{saying.meaning}</p> : null}
                {exampleTranslation(saying.translation) ? (
                  <p lang="zh-CN" className="text-muted-foreground text-sm">
                    {exampleTranslation(saying.translation)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function BlockHeader({ id, title, source }: { id: string; title: string; source: ApiSource }) {
  const api = useApiPeek(source)
  return (
    <>
      <header className="flex items-center gap-3 border-b pb-2">
        <h2 id={id} className="font-semibold text-lg">
          {title}
        </h2>
        <span className="ml-auto">{api.toggle}</span>
      </header>
      {api.panel}
    </>
  )
}

/** Word formation and the word family, then the phrases built on the word. */
export function EntryExtras({ entry, path, payload }: { entry: PublicEntry; path: string; payload: unknown }) {
  const { t } = useTranslation()
  const { morphology, phrases } = entry
  const complex = morphology && (morphology.parts.length > 1 || morphology.shortened)
  return (
    <>
      {morphology && (complex || morphology.family.length > 0) ? (
        <section id="word-family" aria-labelledby="word-family-title" className="flex scroll-mt-24 flex-col gap-3">
          <BlockHeader
            id="word-family-title"
            title={t('entry.wordFamily')}
            source={{ path, payload, slice: ['morphology'] }}
          />
          {complex ? (
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-muted-foreground text-xs uppercase tracking-wide">{t('entry.formation')}</span>
              {morphology.parts.map((part, index) => (
                <Fragment key={`${part.form}-${part.role}`}>
                  {index > 0 ? <span className="text-muted-foreground">+</span> : null}
                  <span className="inline-flex items-baseline gap-1 rounded-md bg-muted px-2 py-0.5">
                    {part.lemma ? (
                      <Link className="font-medium text-primary hover:underline" to={wordPath(part.lemma)}>
                        {part.form}
                      </Link>
                    ) : (
                      <span className="font-medium">{part.form}</span>
                    )}
                    <span className="text-muted-foreground text-xs">
                      {t(`entry.roles.${part.role}`)}
                      {part.meaning ? ` · ${part.meaning}` : ''}
                    </span>
                  </span>
                </Fragment>
              ))}
              {morphology.shortened ? (
                <span className="text-muted-foreground text-sm">
                  {t('entry.shortened', {
                    type: t(`entry.shortening.${morphology.shortened.type}`),
                    of: morphology.shortened.of,
                  })}
                </span>
              ) : null}
            </p>
          ) : null}
          {morphology.family.length > 0 ? <WordLinks words={morphology.family} /> : null}
        </section>
      ) : null}
      {phraseCount(phrases) > 0 ? (
        <section id="phrases" aria-labelledby="phrases-title" className="flex scroll-mt-24 flex-col gap-3">
          <BlockHeader id="phrases-title" title={t('entry.phrases')} source={{ path, payload, slice: ['phrases'] }} />
          <PhraseGroups entry={entry} />
        </section>
      ) : null}
    </>
  )
}
